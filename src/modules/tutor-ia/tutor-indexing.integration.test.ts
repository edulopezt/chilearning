/**
 * Integración de la indexación del Tutor IA (task 5.8a, HU-11.1, ADR-007)
 * contra Supabase local: publicar una lección de texto genera chunks con FTS
 * poblado; despublicar los borra; un `aiClient` FAKE puebla `embedding`; sin
 * proveedor los chunks quedan solo con FTS (retrieval lexical sigue
 * funcionando). Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AiClient, EmbedResult } from "@/modules/tutor-ia/ai-client";
import { noopAiClient } from "@/modules/tutor-ia/ai-client";
import { reindexLesson, type IndexableLesson } from "@/modules/tutor-ia/indexing";
import { searchChunksLexical } from "@/modules/tutor-ia/retrieval";
import { tenantGuard } from "@/lib/tenant-guard";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

let svc: SupabaseClient;
let courseId = "";
let lessonId = "";
let courseIdB = "";

function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => {
    const m = out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"));
    if (!m?.[1]) throw new Error(`falta ${k}`);
    return m[1];
  };
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

const VECTOR_DIMS = 1536;
function fakeVector(seed: number): number[] {
  const v = new Array(VECTOR_DIMS).fill(0);
  v[0] = seed;
  return v;
}

function fakeAiClient(): AiClient {
  return {
    configured: true,
    embeddingModel: "fake-embed-test",
    async embed(texts: string[]): Promise<EmbedResult> {
      return { ok: true, vectors: texts.map((_, i) => fakeVector(i + 1)) };
    },
  };
}

function failingAiClient(): AiClient {
  return {
    configured: true,
    embeddingModel: "fake-embed-fail",
    async embed(): Promise<EmbedResult> {
      return { ok: false, error: "network_error" };
    },
  };
}

function baseLesson(overrides: Partial<IndexableLesson> = {}): IndexableLesson {
  return {
    id: lessonId,
    tenant_id: TENANT_A,
    course_id: courseId,
    title: "Prevención de riesgos: introducción",
    kind: "text",
    content:
      "La prevención de riesgos laborales protege la salud de las personas trabajadoras. " +
      "Un riesgo laboral es la posibilidad de que un trabajador sufra un daño derivado del trabajo.",
    status: "published",
    ...overrides,
  };
}

async function chunksOf(lesson: string) {
  const { data, error } = await svc
    .from("course_chunks")
    .select("id, chunk_index, content, content_tsv, embedding, embedding_model")
    .eq("lesson_id", lesson)
    .order("chunk_index");
  if (error) throw new Error(error.message);
  return data ?? [];
}

beforeAll(async () => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });

  courseId = randomUUID();
  const { error } = await svc.from("courses").insert({
    id: courseId,
    tenant_id: TENANT_A,
    name: "Curso fixture tutor-indexing",
    sence: false,
  });
  if (error) throw new Error(`seed curso: ${error.message}`);

  lessonId = randomUUID();
  const lessonInsert = await svc.from("lessons").insert({
    id: lessonId,
    tenant_id: TENANT_A,
    course_id: courseId,
    title: "Prevención de riesgos: introducción",
    kind: "text",
    content: "contenido inicial",
    position: 1,
    status: "draft",
  });
  if (lessonInsert.error) throw new Error(`seed lección: ${lessonInsert.error.message}`);

  // Curso de OTRO tenant, solo para el test de defensa-en-profundidad de abajo
  // (simula un chunk "mal etiquetado" que comparte lesson_id con TENANT_A).
  courseIdB = randomUUID();
  const courseBInsert = await svc.from("courses").insert({
    id: courseIdB,
    tenant_id: TENANT_B,
    name: "Curso fixture tutor-indexing (tenant B, defensa en profundidad)",
    sence: false,
  });
  if (courseBInsert.error) throw new Error(`seed curso tenant B: ${courseBInsert.error.message}`);
});

afterAll(async () => {
  // Orden respeta las FK restrict: chunks -> lección -> curso.
  await svc.from("course_chunks").delete().eq("lesson_id", lessonId);
  await svc.from("lessons").delete().eq("id", lessonId);
  await svc.from("courses").delete().eq("id", courseId);
  await svc.from("courses").delete().eq("id", courseIdB);
});

describe("reindexLesson (HU-11.1)", () => {
  it("lección en draft: no genera chunks", async () => {
    await reindexLesson(svc, { aiClient: noopAiClient() }, baseLesson({ status: "draft" }));
    expect(await chunksOf(lessonId)).toEqual([]);
  });

  it("publicar una lección de texto: aparecen chunks con content_tsv poblado", async () => {
    await reindexLesson(svc, { aiClient: noopAiClient() }, baseLesson());
    const chunks = await chunksOf(lessonId);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.content_tsv).toBeTruthy();
      expect(String(c.content_tsv).length).toBeGreaterThan(0);
    }
  });

  it("sin aiClient configurado (noop): los chunks quedan SIN embedding pero CON tsvector — el retrieval lexical sigue funcionando", async () => {
    await reindexLesson(svc, { aiClient: noopAiClient() }, baseLesson());
    const chunks = await chunksOf(lessonId);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.embedding === null)).toBe(true);

    const guard = tenantGuard(TENANT_A);
    const fragments = await searchChunksLexical(guard, courseId, "riesgo laboral trabajador", 6);
    expect(fragments.length).toBeGreaterThan(0);
    expect(fragments[0]?.lessonId).toBe(lessonId);
  });

  it("con un aiClient FAKE (deterministico): los chunks quedan CON embedding poblado", async () => {
    await reindexLesson(svc, { aiClient: fakeAiClient() }, baseLesson());
    const chunks = await chunksOf(lessonId);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.embedding).not.toBeNull();
      expect(c.embedding_model).toBe("fake-embed-test");
    }
  });

  it("si el proveedor falla al pedir embeddings: NO es fatal, los chunks quedan con contenido/tsvector pero sin embedding", async () => {
    await reindexLesson(svc, { aiClient: failingAiClient() }, baseLesson());
    const chunks = await chunksOf(lessonId);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.embedding === null)).toBe(true);
    expect(chunks.every((c) => c.content_tsv)).toBe(true);
  });

  it("despublicar: los chunks se borran", async () => {
    await reindexLesson(svc, { aiClient: fakeAiClient() }, baseLesson());
    expect((await chunksOf(lessonId)).length).toBeGreaterThan(0);

    await reindexLesson(svc, { aiClient: noopAiClient() }, baseLesson({ status: "draft" }));
    expect(await chunksOf(lessonId)).toEqual([]);
  });

  it("cambiar de kind=text a video: también borra los chunks", async () => {
    await reindexLesson(svc, { aiClient: noopAiClient() }, baseLesson());
    expect((await chunksOf(lessonId)).length).toBeGreaterThan(0);

    await reindexLesson(svc, { aiClient: noopAiClient() }, baseLesson({ kind: "video", content: "abc123" }));
    expect(await chunksOf(lessonId)).toEqual([]);
  });

  it("NUNCA borra chunks de OTRO tenant aunque compartan lesson_id — defensa en profundidad (hallazgo MED de revisión)", async () => {
    // El worker corre con un cliente service-role crudo (sin tenantGuard()):
    // este test reproduce el escenario que la revisión marcó como riesgo — un
    // chunk mal etiquetado (tenant_id distinto al de la lección real) que
    // comparte `lesson_id`. `course_chunks` no tiene una constraint que ate su
    // `tenant_id` al tenant real de `lessons`, así que esto es insertable
    // directo con el service client, igual que lo sería un futuro bug/refactor.
    const foreignChunkId = randomUUID();
    const foreign = await svc.from("course_chunks").insert({
      id: foreignChunkId,
      tenant_id: TENANT_B,
      course_id: courseIdB,
      lesson_id: lessonId,
      chunk_index: 77,
      lesson_title: "chunk ajeno (fixture defensa en profundidad)",
      content: "contenido que NO debe borrarse desde otro tenant",
    });
    if (foreign.error) throw new Error(`seed chunk ajeno: ${foreign.error.message}`);

    const survives = async () =>
      (await svc.from("course_chunks").select("id").eq("id", foreignChunkId)).data ?? [];

    // Camino 1: delete-then-insert (lección published) -- indexing.ts línea 71.
    await reindexLesson(svc, { aiClient: noopAiClient() }, baseLesson());
    expect(await survives()).toHaveLength(1);

    // Camino 2: no-indexable (lección draft) -- indexing.ts línea 53.
    await reindexLesson(svc, { aiClient: noopAiClient() }, baseLesson({ status: "draft" }));
    expect(await survives()).toHaveLength(1);

    await svc.from("course_chunks").delete().eq("id", foreignChunkId);
  });
});
