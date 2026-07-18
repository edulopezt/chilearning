/**
 * Integración del borrador de IA para staff (task 5.9, HU-9.5) contra Supabase
 * local. Cubre las 3 razones de bloqueo que NUNCA tocan red real (forbidden,
 * not_configured, not_found) — jamás se llama a `aiClient.complete()` con una
 * key configurada de verdad: `generateReplyDraft` arma su propio `aiClient`
 * internamente vía `aiClientFromEnv(process.env)` (mismo patrón que
 * `resolveTutorContext`), así que el camino feliz (respuesta real del
 * proveedor) queda fuera de esta suite a propósito — "jamás la API real" en
 * tests (ver `ai-client.test.ts`). Ese camino ya está cubierto por
 * `buildDraftPrompt`/`stripPIIForDraft` (unit) + `ai-client.test.ts::complete`
 * (fetch inyectado). Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "@/modules/core/domain/rbac";
import { createThread as createForumThread } from "@/modules/comunicacion/forum-service";
import { startThread as startMessageThread } from "@/modules/comunicacion/message-service";
import { generateReplyDraft } from "@/modules/comunicacion/draft-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const USER_STUDENT = "aaaaaaaa-0000-4000-8000-000000000005";
const admin: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };
const instructor: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000003", tenantId: TENANT_A, roles: ["instructor"] };
const student: Principal = { userId: USER_STUDENT, tenantId: TENANT_A, roles: ["student"] };

let svc: SupabaseClient;
let originalOpenRouterKey: string | undefined;

function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

async function freshCourse(): Promise<{ courseId: string; actionId: string }> {
  const courseId = randomUUID();
  await svc.from("courses").insert({ id: courseId, tenant_id: TENANT_A, name: "Curso 5.9 draft", sence: false });
  const actionId = randomUUID();
  await svc.from("actions").insert({ id: actionId, tenant_id: TENANT_A, course_id: courseId, codigo_accion: `DRF-${randomUUID().slice(0, 6)}`, training_line: 3, environment: "rcetest" });
  await svc.from("enrollments").insert({ id: randomUUID(), tenant_id: TENANT_A, action_id: actionId, user_id: USER_STUDENT, run: "5126663-3", first_names: "Ana", last_names: "Díaz" });
  return { courseId, actionId };
}

beforeAll(() => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
  originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
});

afterAll(() => {
  if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
});

describe("generateReplyDraft — gate de rol (HU-9.5)", () => {
  it("el alumno NO puede pedir un borrador (ni en mensajería ni en foro) -> forbidden", async () => {
    const { courseId } = await freshCourse();
    const thread = await startMessageThread(student, courseId, { subject: "Duda", body: "¿Cómo entrego la tarea?" });
    expect(thread.ok).toBe(true);
    if (!thread.ok) return;

    expect(await generateReplyDraft(student, "message", thread.id)).toEqual({ ok: false, error: "forbidden" });
    expect(await generateReplyDraft(student, "forum", thread.id)).toEqual({ ok: false, error: "forbidden" });
  });

  it("un principal sin tenant -> forbidden", async () => {
    const noTenant: Principal = { userId: randomUUID(), tenantId: null, roles: ["otec_admin"] };
    expect(await generateReplyDraft(noTenant, "message", randomUUID())).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("generateReplyDraft — sin OPENROUTER_API_KEY -> not_configured (staff)", () => {
  it("aunque el hilo exista y tenga mensaje del alumno, sin proveedor configurado no se intenta nada más", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { courseId } = await freshCourse();
    const thread = await startMessageThread(student, courseId, { subject: "Duda", body: "¿Cómo entrego la tarea?" });
    expect(thread.ok).toBe(true);
    if (!thread.ok) return;

    expect(await generateReplyDraft(admin, "message", thread.id)).toEqual({ ok: false, error: "not_configured" });
  });
});

describe("generateReplyDraft — con proveedor 'configurado' pero SIN llegar nunca a llamar red (not_found)", () => {
  beforeAll(() => {
    // Key ficticia: alcanza para pasar `aiClient.configured`, pero estos casos
    // devuelven `not_found` ANTES de que el código llegue a `aiClient.complete()`
    // (no hay llamada de red posible en esta suite).
    process.env.OPENROUTER_API_KEY = "test-dummy-key";
  });

  it("thread inexistente -> not_found (mensajería y foro)", async () => {
    expect(await generateReplyDraft(admin, "message", randomUUID())).toEqual({ ok: false, error: "not_found" });
    expect(await generateReplyDraft(admin, "forum", randomUUID())).toEqual({ ok: false, error: "not_found" });
  });

  it("hilo de mensajería SIN ningún mensaje del alumno -> not_found", async () => {
    const { courseId } = await freshCourse();
    // Insertado directo por service-role: `startThread` siempre exige que el
    // PRIMER mensaje sea del alumno, así que un hilo "solo staff" no es
    // alcanzable por el flujo normal de la app -- se fabrica el estado aquí.
    const { data: t, error } = await svc
      .from("message_threads")
      .insert({ tenant_id: TENANT_A, course_id: courseId, student_user_id: USER_STUDENT, subject: "Solo staff" })
      .select("id")
      .single();
    expect(error).toBeNull();
    await svc.from("messages").insert({ tenant_id: TENANT_A, thread_id: t!.id, sender_user_id: instructor.userId, sender_is_staff: true, body: "Aviso interno, sin pregunta del alumno." });

    expect(await generateReplyDraft(admin, "message", t!.id as string)).toEqual({ ok: false, error: "not_found" });
  });

  it("hilo de foro creado por el STAFF (sin ningún post del alumno) -> not_found", async () => {
    const { courseId } = await freshCourse();
    // El staff SÍ puede abrir un hilo de foro (a diferencia de mensajería):
    // alcanza para modelar "cero posts del alumno" sin tocar la BD a mano.
    const created = await createForumThread(instructor, courseId, { title: "Aviso del relator", body: "Recordatorio del módulo 3." });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(await generateReplyDraft(admin, "forum", created.id)).toEqual({ ok: false, error: "not_found" });
  });
});
