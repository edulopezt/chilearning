/**
 * Integración del retrieval híbrido del Tutor IA (task 5.8a, ADR-007) contra
 * Supabase local: con un `aiClient` fake CONFIGURADO usa modo vector; con
 * `noopAiClient` cae a modo lexical automáticamente; ambos encuentran el
 * chunk sembrado por una query relacionada. Requiere `supabase start` +
 * `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { tenantGuard } from "@/lib/tenant-guard";
import type { AiClient, EmbedResult } from "@/modules/tutor-ia/ai-client";
import { noopAiClient } from "@/modules/tutor-ia/ai-client";
import { reindexLesson } from "@/modules/tutor-ia/indexing";
import { searchChunks } from "@/modules/tutor-ia/retrieval";

const TENANT_A = "11111111-1111-4111-8111-111111111111";

let svc: SupabaseClient;
let courseId = "";
let lessonId = "";

function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => {
    const m = out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"));
    if (!m?.[1]) throw new Error(`falta ${k}`);
    return m[1];
  };
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

// Vector FIJO (mismo para cualquier texto): con un solo chunk indexado, la
// distancia coseno consigo mismo es 0 -- siempre "gana" el retrieval vectorial
// sin depender de un embedding real.
const FIXED_VECTOR = (() => {
  const v = new Array(1536).fill(0);
  v[0] = 1;
  return v;
})();

// `chatStream` no se ejercita en esta suite (solo retrieval): un stub mínimo
// alcanza para satisfacer la interfaz `AiClient` (task 5.8b).
async function* unusedChatStream(): AsyncGenerator<{ type: "error"; error: string }> {
  yield { type: "error", error: "not_used_in_this_test" };
}

function fakeAiClient(): AiClient {
  return {
    configured: true,
    embeddingModel: "fake-embed-test",
    async embed(texts: string[]): Promise<EmbedResult> {
      return { ok: true, vectors: texts.map(() => FIXED_VECTOR) };
    },
    chatStream: unusedChatStream,
  };
}

beforeAll(async () => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });

  courseId = randomUUID();
  const course = await svc.from("courses").insert({
    id: courseId,
    tenant_id: TENANT_A,
    name: "Curso fixture tutor-retrieval",
    sence: false,
  });
  if (course.error) throw new Error(`seed curso: ${course.error.message}`);

  lessonId = randomUUID();
  const lesson = await svc.from("lessons").insert({
    id: lessonId,
    tenant_id: TENANT_A,
    course_id: courseId,
    title: "Elementos de protección personal",
    kind: "text",
    content:
      "Los elementos de protección personal (EPP) son equipos que usa el trabajador para " +
      "reducir la exposición a riesgos laborales, como cascos, guantes y arnés de seguridad.",
    position: 1,
    status: "published",
  });
  if (lesson.error) throw new Error(`seed lección: ${lesson.error.message}`);

  // Indexa CON embedding (fake) para que el chunk quede disponible tanto para
  // el modo vector como para el lexical (mismo contenido, ambos caminos).
  await reindexLesson(
    svc,
    { aiClient: fakeAiClient() },
    {
      id: lessonId,
      tenant_id: TENANT_A,
      course_id: courseId,
      title: "Elementos de protección personal",
      kind: "text",
      content:
        "Los elementos de protección personal (EPP) son equipos que usa el trabajador para " +
        "reducir la exposición a riesgos laborales, como cascos, guantes y arnés de seguridad.",
      status: "published",
    },
  );
});

afterAll(async () => {
  await svc.from("course_chunks").delete().eq("lesson_id", lessonId);
  await svc.from("lessons").delete().eq("id", lessonId);
  await svc.from("courses").delete().eq("id", courseId);
});

describe("searchChunks (retrieval híbrido, ADR-007)", () => {
  it("aiClient fake CONFIGURADO -> usa modo vector y encuentra el chunk sembrado", async () => {
    const guard = tenantGuard(TENANT_A);
    const { fragments, mode } = await searchChunks(guard, fakeAiClient(), courseId, "elementos de protección personal", 6);
    expect(mode).toBe("vector");
    expect(fragments.length).toBeGreaterThan(0);
    expect(fragments[0]?.lessonId).toBe(lessonId);
  });

  it("noopAiClient (sin proveedor) -> cae a modo lexical automáticamente y encuentra el chunk", async () => {
    const guard = tenantGuard(TENANT_A);
    const { fragments, mode } = await searchChunks(guard, noopAiClient(), courseId, "elementos de protección personal", 6);
    expect(mode).toBe("lexical");
    expect(fragments.length).toBeGreaterThan(0);
    expect(fragments[0]?.lessonId).toBe(lessonId);
  });

  it("aiClient configurado pero el embed() falla -> cae a lexical igual (nunca deja al alumno sin retrieval)", async () => {
    const failing: AiClient = {
      configured: true,
      embeddingModel: "fake-fail",
      async embed(): Promise<EmbedResult> {
        return { ok: false, error: "network_error" };
      },
      chatStream: unusedChatStream,
    };
    const guard = tenantGuard(TENANT_A);
    const { fragments, mode } = await searchChunks(guard, failing, courseId, "elementos de protección personal", 6);
    expect(mode).toBe("lexical");
    expect(fragments.length).toBeGreaterThan(0);
  });

  it("numera los fragments 1..k para calzar con buildTutorPrompt", async () => {
    const guard = tenantGuard(TENANT_A);
    const { fragments } = await searchChunks(guard, noopAiClient(), courseId, "riesgos laborales EPP", 6);
    expect(fragments.map((f) => f.n)).toEqual(fragments.map((_, i) => i + 1));
  });
});
