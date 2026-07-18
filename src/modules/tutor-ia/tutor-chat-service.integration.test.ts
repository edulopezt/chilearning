/**
 * Integración de `tutor-chat-service.ts` (task 5.8b, HU-11.1/11.2/11.3) contra
 * Supabase local: gate de acceso (`resolveTutorContext`, los 5 `reason` de
 * bloqueo), presupuesto (`checkBudgetForContext`, LECTURA pura, tenant
 * primero; y `reserveBudgetForContext`, la reserva ATÓMICA vía RPC que sí
 * hace enforcement real — incluye tests de RÁFAGA CONCURRENTE que reproducen
 * el TOCTOU del hallazgo de revisión de seguridad, 2026-07-18), conversación
 * + historial cronológico, persistencia (`persistAssistantMessage` con las 2
 * RPCs vía el cliente de SESIÓN real), el ensamblaje del prompt en el PUNTO DE
 * USO real (minimización, HU-11.3) y el streaming completo (`streamTutorAnswer`,
 * feliz + error upstream) con un `aiClient` inyectado — NUNCA red real.
 * Requiere `supabase start` + `supabase db reset`.
 *
 * ⚠ ÚNICO mock de módulo de todo este repo (justificación): `resolveTutorContext`
 * reusa `getStudentCourseView()` (task 5.8a/5.8b), que llama internamente
 * `createSupabaseServerClient()` — atado a `next/headers` (cookies), inexistente
 * fuera de un request real de Next (mismo motivo documentado en
 * `scorm-runtime.integration.test.ts`: "ningún otro test de este repo invoca un
 * route handler por esa razón"). Para poder probar el gate de acceso completo
 * (los 5 `reason`) sin inventar un segundo mecanismo de resolución de curso, se
 * reemplaza ÚNICAMENTE `@/lib/supabase/server`'s `createSupabaseServerClient`
 * por un cliente anon-key REAL, autenticado con un JWT firmado para el alumno
 * de prueba — mismo mecanismo, mismo RLS real, que el helper `client(token)` de
 * `tutor-ia.rls.test.ts`. No se mockea NINGUNA lógica de negocio, solo el
 * puente cookies→cliente que Next exige y Vitest no puede proveer. El resto de
 * las funciones de este archivo (`getOrCreateConversation`, `checkBudgetForContext`,
 * `persistAssistantMessage`, `streamTutorAnswer`, …) NO necesitan este mock:
 * reciben su `TutorContext`/`sessionDb` como parámetros explícitos — por eso
 * la ruta `/api/tutor/chat` tampoco tiene un test propio (wrapper delgado que
 * solo llama a estas funciones ya cubiertas; ver el comentario en `route.ts`).
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import { tenantGuard } from "@/lib/tenant-guard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Principal } from "@/modules/core/domain/rbac";
import type { AiClient, ChatMessage, ChatStreamChunk, CompleteResult, EmbedResult } from "@/modules/tutor-ia/ai-client";
import {
  checkBudgetForContext,
  getOrCreateConversation,
  loadRecentHistory,
  persistAssistantMessage,
  persistUserMessage,
  reserveBudgetForContext,
  resolveTutorContext,
  streamTutorAnswer,
  type TutorContext,
} from "@/modules/tutor-ia/tutor-chat-service";

let svc: SupabaseClient;
let localEnv: { apiUrl: string; anonKey: string; serviceRoleKey: string; jwtSecret: string };
const seededTenants: string[] = [];
const seededUsers: string[] = [];
let originalOpenRouterKey: string | undefined;

/** `enrollments.user_id` exige un `auth.users` REAL (FK) — mismo patrón que
 *  `expiry-report.integration.test.ts`'s `freshUser()`. */
async function freshUser(): Promise<string> {
  const { data, error } = await svc.auth.admin.createUser({
    email: `tutor-chat-${randomUUID().slice(0, 12)}@t.cl`,
    email_confirm: true,
    password: `Tc-${randomUUID()}`,
  });
  if (error || !data?.user) throw new Error(`createUser: ${error?.message ?? "sin id"}`);
  seededUsers.push(data.user.id);
  return data.user.id;
}

function loadLocalEnv(): typeof localEnv {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (key: string): string => {
    const match = out.match(new RegExp(`^${key}="?([^"\\r\\n]+)"?$`, "m"));
    if (!match?.[1]) throw new Error(`supabase status no expone ${key}`);
    return match[1];
  };
  return {
    apiUrl: get("API_URL"),
    anonKey: get("ANON_KEY"),
    serviceRoleKey: get("SERVICE_ROLE_KEY"),
    jwtSecret: get("JWT_SECRET"),
  };
}

async function mintJwt(claims: { sub: string; tenant_id?: string; roles: string[] }): Promise<string> {
  return new SignJWT({
    role: "authenticated",
    ...(claims.tenant_id ? { tenant_id: claims.tenant_id } : {}),
    roles: claims.roles,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(localEnv.jwtSecret));
}

function anonClient(token: string): SupabaseClient {
  return createClient(localEnv.apiUrl, localEnv.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Cliente de SESIÓN real (mismo RLS que produciría `createSupabaseServerClient()` en Next). */
async function studentSessionClient(userId: string, tenantId: string): Promise<SupabaseClient> {
  const token = await mintJwt({ sub: userId, tenant_id: tenantId, roles: ["student"] });
  return anonClient(token);
}

function studentPrincipal(userId: string, tenantId: string): Principal {
  return { userId, tenantId, roles: ["student"] };
}

/** `TutorContext` construido a mano a partir de una `Fixture` — evita pasar por
 *  `resolveTutorContext` (y su mock) en los tests que no ejercitan el gate. */
function buildContext(fx: Fixture, overrides?: Partial<TutorContext>): TutorContext {
  return {
    guard: tenantGuard(fx.tenantId),
    tenantId: fx.tenantId,
    userId: fx.studentUserId,
    enrollmentId: fx.enrollmentId,
    courseId: fx.courseId,
    courseName: "Curso de integración Tutor IA",
    firstName: "Ana",
    aggregateProgress: { completed: 0, total: 1 },
    ...overrides,
  };
}

interface Fixture {
  readonly tenantId: string;
  readonly courseId: string;
  readonly actionId: string;
  readonly lessonId: string;
  readonly enrollmentId: string;
  readonly studentUserId: string;
}

/** Tenant + curso + acción + lección + inscripción, todo NUEVO y aislado (evita cruzar otros archivos de integración). */
async function seedFixture(opts: {
  featureOn: boolean;
  courseConfig?: { enabled: boolean; dailyMessageLimit?: number | null };
  monthlyTokenBudget?: number | null;
  studentUserId?: string;
  firstNames?: string;
  lastNames?: string;
  seedChunk?: boolean;
}): Promise<Fixture> {
  const tenantId = randomUUID();
  const courseId = randomUUID();
  const actionId = randomUUID();
  const lessonId = randomUUID();
  const enrollmentId = randomUUID();
  const studentUserId = opts.studentUserId ?? (await freshUser());

  const { error: tErr } = await svc.from("tenants").insert({
    id: tenantId,
    slug: `tutor-chat-test-${tenantId.slice(0, 8)}`,
    name: "OTEC de integración (Tutor IA)",
    flags: opts.featureOn ? { ai_tutor: true } : {},
  });
  if (tErr) throw new Error(`seed tenants: ${tErr.message}`);
  seededTenants.push(tenantId);

  const { error: cErr } = await svc
    .from("courses")
    .insert({ id: courseId, tenant_id: tenantId, name: "Curso de integración Tutor IA" });
  if (cErr) throw new Error(`seed courses: ${cErr.message}`);

  const { error: aErr } = await svc.from("actions").insert({
    id: actionId,
    tenant_id: tenantId,
    course_id: courseId,
    codigo_accion: `ACC-TUTOR-${actionId.slice(0, 8)}`,
    training_line: 3,
    environment: "rcetest",
    attendance_lock: false,
  });
  if (aErr) throw new Error(`seed actions: ${aErr.message}`);

  const { error: lErr } = await svc.from("lessons").insert({
    id: lessonId,
    tenant_id: tenantId,
    course_id: courseId,
    title: "Elementos de protección personal",
    kind: "text",
    content: "Los elementos de protección personal (EPP) reducen la exposición a riesgos laborales.",
    position: 1,
    status: "published",
  });
  if (lErr) throw new Error(`seed lessons: ${lErr.message}`);

  const { error: eErr } = await svc.from("enrollments").insert({
    id: enrollmentId,
    tenant_id: tenantId,
    action_id: actionId,
    user_id: studentUserId,
    run: "5126663-3",
    exento: false,
    first_names: opts.firstNames ?? "Ana",
    last_names: opts.lastNames ?? "González",
  });
  if (eErr) throw new Error(`seed enrollments: ${eErr.message}`);

  if (opts.courseConfig) {
    const { error } = await svc.from("tutor_course_config").insert({
      tenant_id: tenantId,
      course_id: courseId,
      enabled: opts.courseConfig.enabled,
      daily_message_limit: opts.courseConfig.dailyMessageLimit ?? null,
    });
    if (error) throw new Error(`seed tutor_course_config: ${error.message}`);
  }

  if (opts.monthlyTokenBudget !== undefined) {
    const { error } = await svc
      .from("tutor_tenant_budget")
      .insert({ tenant_id: tenantId, monthly_token_budget: opts.monthlyTokenBudget });
    if (error) throw new Error(`seed tutor_tenant_budget: ${error.message}`);
  }

  if (opts.seedChunk) {
    const { error } = await svc.from("course_chunks").insert({
      tenant_id: tenantId,
      course_id: courseId,
      lesson_id: lessonId,
      chunk_index: 0,
      lesson_title: "Elementos de protección personal",
      content: "Los elementos de protección personal (EPP) reducen la exposición a riesgos laborales.",
    });
    if (error) throw new Error(`seed course_chunks: ${error.message}`);
  }

  return { tenantId, courseId, actionId, lessonId, enrollmentId, studentUserId };
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await svc.from("tutor_messages").delete().eq("tenant_id", tenantId);
  await svc.from("tutor_conversations").delete().eq("tenant_id", tenantId);
  // Sin GRANT de delete para nadie en tutor_usage_daily (ledger agregado, ver
  // la migración 5.8a): best-effort, `supabase db reset` es lo que limpia de
  // verdad entre corridas completas de la suite.
  await svc.from("tutor_usage_daily").delete().eq("tenant_id", tenantId);
  await svc.from("audit_log").delete().eq("tenant_id", tenantId);
  await svc.from("tutor_tenant_budget").delete().eq("tenant_id", tenantId);
  await svc.from("tutor_course_config").delete().eq("tenant_id", tenantId);
  await svc.from("course_chunks").delete().eq("tenant_id", tenantId);
  await svc.from("enrollments").delete().eq("tenant_id", tenantId);
  await svc.from("lessons").delete().eq("tenant_id", tenantId);
  await svc.from("actions").delete().eq("tenant_id", tenantId);
  await svc.from("courses").delete().eq("tenant_id", tenantId);
  await svc.from("tenants").delete().eq("id", tenantId);
}

/** aiClient fake que NUNCA toca red: guiona un `chatStream` fijo y opcionalmente captura los `messages` recibidos. */
function scriptedAiClient(opts: {
  chunks: ChatStreamChunk[];
  captureMessages?: (messages: ChatMessage[]) => void;
}): AiClient {
  return {
    configured: false, // fuerza retrieval lexical (determinista, sin embeddings)
    async embed(): Promise<EmbedResult> {
      return { ok: false, error: "not_used_in_this_test" };
    },
    chatStream(messages: ChatMessage[]): AsyncGenerator<ChatStreamChunk> {
      opts.captureMessages?.(messages);
      return (async function* () {
        for (const c of opts.chunks) yield c;
      })();
    },
    async complete(): Promise<CompleteResult> {
      return { ok: false, error: "not_used_in_this_test" };
    },
  };
}

beforeAll(() => {
  localEnv = loadLocalEnv();
  // Las funciones de servicio usan `tenantGuard()` -> `serverEnv()`, que lee
  // estas 2 vars de `process.env` (mismo patrón que el resto de la suite
  // `integration`, ver `scorm-runtime.integration.test.ts`).
  process.env.NEXT_PUBLIC_SUPABASE_URL = localEnv.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = localEnv.serviceRoleKey;
  svc = createClient(localEnv.apiUrl, localEnv.serviceRoleKey, { auth: { persistSession: false } });
  originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
});

afterAll(async () => {
  for (const tenantId of seededTenants) await cleanupTenant(tenantId);
  // Enrollments (que referencian estos users) ya se borraron arriba -> el
  // FK `restrict` de auth.users permite ahora borrar los usuarios de prueba.
  for (const userId of seededUsers) await svc.auth.admin.deleteUser(userId).catch(() => undefined);
  if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
});

describe("resolveTutorContext — los 5 `reason` de bloqueo (HU-11.1)", () => {
  it("sin rol student -> not_student (no llega a tocar la BD/sesión)", async () => {
    const principal: Principal = { userId: randomUUID(), tenantId: randomUUID(), roles: ["otec_admin"] };
    const result = await resolveTutorContext(principal);
    expect(result).toEqual({ ok: false, reason: "not_student" });
  });

  it("student sin inscripción -> no_enrollment", async () => {
    const fx = await seedFixture({ featureOn: true, courseConfig: { enabled: true } });
    const strangerId = randomUUID(); // nunca se inscribe en nada
    vi.mocked(createSupabaseServerClient).mockResolvedValue(await studentSessionClient(strangerId, fx.tenantId));

    const result = await resolveTutorContext(studentPrincipal(strangerId, fx.tenantId));
    expect(result).toEqual({ ok: false, reason: "no_enrollment" });
  });

  it("feature ai_tutor apagada para el tenant -> feature_disabled", async () => {
    const fx = await seedFixture({ featureOn: false });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(await studentSessionClient(fx.studentUserId, fx.tenantId));

    const result = await resolveTutorContext(studentPrincipal(fx.studentUserId, fx.tenantId));
    expect(result).toEqual({ ok: false, reason: "feature_disabled" });
  });

  it("curso SIN fila de config -> course_disabled", async () => {
    const fx = await seedFixture({ featureOn: true }); // sin tutor_course_config
    vi.mocked(createSupabaseServerClient).mockResolvedValue(await studentSessionClient(fx.studentUserId, fx.tenantId));

    const result = await resolveTutorContext(studentPrincipal(fx.studentUserId, fx.tenantId));
    expect(result).toEqual({ ok: false, reason: "course_disabled" });
  });

  it("curso con config DESHABILITADA -> course_disabled", async () => {
    const fx = await seedFixture({ featureOn: true, courseConfig: { enabled: false } });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(await studentSessionClient(fx.studentUserId, fx.tenantId));

    const result = await resolveTutorContext(studentPrincipal(fx.studentUserId, fx.tenantId));
    expect(result).toEqual({ ok: false, reason: "course_disabled" });
  });

  it("sin OPENROUTER_API_KEY -> not_configured", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const fx = await seedFixture({ featureOn: true, courseConfig: { enabled: true } });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(await studentSessionClient(fx.studentUserId, fx.tenantId));

    const result = await resolveTutorContext(studentPrincipal(fx.studentUserId, fx.tenantId));
    expect(result).toEqual({ ok: false, reason: "not_configured" });
  });

  it("con todo en orden -> ok:true, firstName SANEADO desde el snapshot de enrollments (test estrella de minimización)", async () => {
    process.env.OPENROUTER_API_KEY = "test-dummy-key";
    // Snapshot "envenenado" a propósito: RUN, correo y "empresa" colados en
    // first_names/last_names (p.ej. un import CSV corrupto) -- `resolveTutorContext`
    // DEBE sanear esto antes de que llegue al contexto (y, más abajo, al prompt).
    const fx = await seedFixture({
      featureOn: true,
      courseConfig: { enabled: true, dailyMessageLimit: 5 },
      firstNames: "Juan RUN 12.345.678-9 correo juan.perez@empresa-acme.cl",
      lastNames: "Pérez Soto — Empresa ACME SpA",
      seedChunk: true,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(await studentSessionClient(fx.studentUserId, fx.tenantId));

    const result = await resolveTutorContext(studentPrincipal(fx.studentUserId, fx.tenantId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.firstName).toBe("Juan");
    expect(result.context.courseId).toBe(fx.courseId);
    expect(result.context.enrollmentId).toBe(fx.enrollmentId);
    expect(result.context.aggregateProgress).toEqual({ completed: 0, total: 1 });
  });
});

describe("checkBudgetForContext — LECTURA pura, tenant primero luego límite diario (HU-11.2)", () => {
  it("sin uso previo -> ok:true (usa el default de 30/día y el default de presupuesto)", async () => {
    const fx = await seedFixture({ featureOn: true, courseConfig: { enabled: true } });
    const result = await checkBudgetForContext(buildContext(fx));
    expect(result).toEqual({ ok: true });
  });

  it("alcanza el límite diario del curso -> bloqueado con reason daily_limit", async () => {
    const fx = await seedFixture({ featureOn: true, courseConfig: { enabled: true, dailyMessageLimit: 2 } });
    const context = buildContext(fx);
    const sessionDb = await studentSessionClient(fx.studentUserId, fx.tenantId);
    const today = new Date().toISOString().slice(0, 10);

    // 2 mensajes ya usados hoy == el límite (2): el 3er intento se bloquea.
    for (let i = 0; i < 2; i += 1) {
      const { error } = await sessionDb.rpc("tutor_add_usage", {
        p_tenant_id: fx.tenantId,
        p_user_id: fx.studentUserId,
        p_day: today,
        p_messages: 1,
        p_input_tokens: 5,
        p_output_tokens: 5,
      });
      expect(error).toBeNull();
    }

    const result = await checkBudgetForContext(context);
    expect(result).toEqual({ ok: false, reason: "daily_limit" });
  });

  it("presupuesto del TENANT agotado bloquea aunque el alumno tenga margen diario (se evalúa primero)", async () => {
    const fx = await seedFixture({
      featureOn: true,
      courseConfig: { enabled: true, dailyMessageLimit: 30 },
      monthlyTokenBudget: 100, // presupuesto minúsculo, a propósito
    });
    const context = buildContext(fx);
    const sessionDb = await studentSessionClient(fx.studentUserId, fx.tenantId);
    const today = new Date().toISOString().slice(0, 10);

    // Un solo mensaje (muy por debajo del límite diario) pero con muchos tokens.
    const { error } = await sessionDb.rpc("tutor_add_usage", {
      p_tenant_id: fx.tenantId,
      p_user_id: fx.studentUserId,
      p_day: today,
      p_messages: 1,
      p_input_tokens: 80,
      p_output_tokens: 80,
    });
    expect(error).toBeNull();

    const result = await checkBudgetForContext(context);
    expect(result).toEqual({ ok: false, reason: "tenant_budget" });
  });
});

// Hallazgo de revisión de seguridad (2026-07-18, MEDIUM, CONFIRMADO en
// verificación independiente): el enforcement anterior (`checkBudgetForContext`
// llamado en `route.ts`, luego el incremento SOLO al final de todo el
// streaming) tenía una ventana de carrera TOCTOU explotable con requests
// concurrentes — sin ningún test que la ejercitara. Estos tests reproducen
// exactamente ese escenario contra Postgres real y prueban que la RPC atómica
// (`tutor_try_reserve_message`, migración `20260719000000_tutor_usage_reserve.sql`)
// la cierra.
describe("reserveBudgetForContext — reserva ATÓMICA (cierra el TOCTOU, HU-11.2)", () => {
  it("sin uso previo -> ok:true y el contador de mensajes avanza en 1 (la reserva YA cuenta el mensaje)", async () => {
    const fx = await seedFixture({ featureOn: true, courseConfig: { enabled: true, dailyMessageLimit: 5 } });
    const context = buildContext(fx);
    const sessionDb = await studentSessionClient(fx.studentUserId, fx.tenantId);

    const result = await reserveBudgetForContext(context, sessionDb);
    expect(result).toEqual({ ok: true });

    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await svc
      .from("tutor_usage_daily")
      .select("messages")
      .eq("tenant_id", fx.tenantId)
      .eq("user_id", fx.studentUserId)
      .eq("day", today)
      .maybeSingle();
    expect(usage?.messages).toBe(1);
  });

  it("RÁFAGA CONCURRENTE con 1 solo cupo diario restante -> exactamente 1 request gana, el resto bloqueado con daily_limit (antes de este fix, TODAS pasaban)", async () => {
    const fx = await seedFixture({ featureOn: true, courseConfig: { enabled: true, dailyMessageLimit: 1 } });
    const context = buildContext(fx);
    const sessionDb = await studentSessionClient(fx.studentUserId, fx.tenantId);

    // 5 intentos DE VERDAD concurrentes (mismo alumno) — trivial de scriptear
    // sin pasar por la UI, exactamente el escenario del hallazgo.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => reserveBudgetForContext(context, sessionDb)),
    );

    const allowed = results.filter((r) => r.ok);
    const blocked = results.filter((r) => !r.ok);
    expect(allowed).toHaveLength(1);
    expect(blocked).toHaveLength(4);
    for (const r of blocked) {
      expect(r).toEqual({ ok: false, reason: "daily_limit" });
    }

    // El contador final refleja EXACTAMENTE 1 mensaje, no 5 (lo que habría
    // ocurrido con el enforcement no-atómico anterior).
    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await svc
      .from("tutor_usage_daily")
      .select("messages")
      .eq("tenant_id", fx.tenantId)
      .eq("user_id", fx.studentUserId)
      .eq("day", today)
      .maybeSingle();
    expect(usage?.messages).toBe(1);
  });

  it("RÁFAGA CONCURRENTE con el presupuesto del TENANT ya agotado -> TODAS bloqueadas con tenant_budget, ningún mensaje se reserva", async () => {
    const fx = await seedFixture({
      featureOn: true,
      courseConfig: { enabled: true, dailyMessageLimit: 30 },
      monthlyTokenBudget: 100,
    });
    const context = buildContext(fx);
    const sessionDb = await studentSessionClient(fx.studentUserId, fx.tenantId);
    const today = new Date().toISOString().slice(0, 10);

    // Presupuesto del tenant YA agotado por un mensaje previo con muchos tokens.
    const { error } = await sessionDb.rpc("tutor_add_usage", {
      p_tenant_id: fx.tenantId,
      p_user_id: fx.studentUserId,
      p_day: today,
      p_messages: 1,
      p_input_tokens: 80,
      p_output_tokens: 80,
    });
    expect(error).toBeNull();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => reserveBudgetForContext(context, sessionDb)),
    );
    for (const r of results) {
      expect(r).toEqual({ ok: false, reason: "tenant_budget" });
    }

    // El chequeo del presupuesto del tenant ocurre ANTES de reservar el
    // mensaje (mismo orden que `checkTutorBudget`): el contador de mensajes
    // se mantiene en el 1 previo, ninguna de las 5 ráfagas lo incrementó.
    const { data: usage } = await svc
      .from("tutor_usage_daily")
      .select("messages")
      .eq("tenant_id", fx.tenantId)
      .eq("user_id", fx.studentUserId)
      .eq("day", today)
      .maybeSingle();
    expect(usage?.messages).toBe(1);
  });
});

describe("getOrCreateConversation / loadRecentHistory / persistUserMessage", () => {
  it("crea la conversación la primera vez y REUTILIZA la misma en la segunda llamada", async () => {
    const fx = await seedFixture({ featureOn: true, courseConfig: { enabled: true } });
    const context = buildContext(fx);

    const first = await getOrCreateConversation(context);
    const second = await getOrCreateConversation(context);
    expect(second.id).toBe(first.id);
  });

  it("loadRecentHistory devuelve los mensajes en orden CRONOLÓGICO ascendente", async () => {
    const fx = await seedFixture({ featureOn: true, courseConfig: { enabled: true } });
    const context = buildContext(fx);
    const conversation = await getOrCreateConversation(context);

    // created_at explícito y espaciado: evita ambigüedad de orden por timestamps iguales.
    const base = Date.now();
    const rows = [
      { role: "user", content: "primera pregunta", offsetMs: 0 },
      { role: "assistant", content: "primera respuesta", offsetMs: 1000 },
      { role: "user", content: "segunda pregunta", offsetMs: 2000 },
    ] as const;
    for (const r of rows) {
      const { error } = await svc.from("tutor_messages").insert({
        tenant_id: fx.tenantId,
        conversation_id: conversation.id,
        user_id: fx.studentUserId,
        role: r.role,
        content: r.content,
        created_at: new Date(base + r.offsetMs).toISOString(),
      });
      expect(error).toBeNull();
    }

    const history = await loadRecentHistory(context, conversation.id, 10);
    expect(history.map((h) => h.content)).toEqual(["primera pregunta", "primera respuesta", "segunda pregunta"]);
  });

  it("persistUserMessage inserta el mensaje del alumno", async () => {
    const fx = await seedFixture({ featureOn: true, courseConfig: { enabled: true } });
    const context = buildContext(fx);
    const conversation = await getOrCreateConversation(context);

    await persistUserMessage(context, conversation.id, "¿qué son los EPP?");

    const { data } = await svc
      .from("tutor_messages")
      .select("role, content")
      .eq("conversation_id", conversation.id)
      .eq("role", "user");
    expect(data).toEqual([{ role: "user", content: "¿qué son los EPP?" }]);
  });
});

describe("persistAssistantMessage — 2 RPCs vía el cliente de SESIÓN (nunca guard.db)", () => {
  it("con el cliente de SESIÓN real: guarda el mensaje y ACUMULA tokens + costo del día (el mensaje YA fue contado por reserveBudgetForContext, no por esta función)", async () => {
    const fx = await seedFixture({ featureOn: true, courseConfig: { enabled: true } });
    const context = buildContext(fx);
    const conversation = await getOrCreateConversation(context);
    const sessionDb = await studentSessionClient(fx.studentUserId, fx.tenantId);

    // Mismo orden que la request real (`route.ts`): la reserva ocurre ANTES,
    // cuenta el mensaje; `persistAssistantMessage` solo agrega tokens/costo
    // (pasa `p_messages: 0` — contarlo de nuevo aquí lo duplicaría).
    const reserved = await reserveBudgetForContext(context, sessionDb);
    expect(reserved).toEqual({ ok: true });

    await persistAssistantMessage(
      context,
      sessionDb,
      conversation.id,
      "Los EPP son... [1]",
      [{ lessonId: fx.lessonId, lessonTitle: "Elementos de protección personal" }],
      { promptTokens: 50, completionTokens: 20, costUsd: 0.00012 },
    );

    const { data: msg } = await svc
      .from("tutor_messages")
      .select("content, citations, input_tokens, output_tokens")
      .eq("conversation_id", conversation.id)
      .eq("role", "assistant")
      .maybeSingle();
    expect(msg?.content).toBe("Los EPP son... [1]");
    expect(msg?.citations).toEqual([{ lessonId: fx.lessonId, lessonTitle: "Elementos de protección personal" }]);
    expect(msg?.input_tokens).toBe(50);
    expect(msg?.output_tokens).toBe(20);

    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await svc
      .from("tutor_usage_daily")
      .select("messages, input_tokens, output_tokens, cost_usd")
      .eq("tenant_id", fx.tenantId)
      .eq("user_id", fx.studentUserId)
      .eq("day", today)
      .maybeSingle();
    // 1, no 2: viene de la reserva, `persistAssistantMessage` no lo duplicó.
    expect(usage?.messages).toBe(1);
    expect(usage?.input_tokens).toBe(50);
    expect(usage?.output_tokens).toBe(20);
    expect(Number(usage?.cost_usd)).toBeCloseTo(0.00012, 6);
  });

  it("usage null (stream sin chunk de usage) -> el mensaje YA fue cobrado en la reserva (no en 0, gracias a reserveBudgetForContext); tokens/costo quedan en cero", async () => {
    const fx = await seedFixture({ featureOn: true, courseConfig: { enabled: true } });
    const context = buildContext(fx);
    const conversation = await getOrCreateConversation(context);
    const sessionDb = await studentSessionClient(fx.studentUserId, fx.tenantId);

    const reserved = await reserveBudgetForContext(context, sessionDb);
    expect(reserved).toEqual({ ok: true });

    await persistAssistantMessage(context, sessionDb, conversation.id, "", [], null);

    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await svc
      .from("tutor_usage_daily")
      .select("messages, input_tokens, output_tokens, cost_usd")
      .eq("tenant_id", fx.tenantId)
      .eq("user_id", fx.studentUserId)
      .eq("day", today)
      .maybeSingle();
    expect(usage?.messages).toBe(1);
    expect(usage?.input_tokens).toBe(0);
    expect(usage?.output_tokens).toBe(0);
    expect(Number(usage?.cost_usd ?? 0)).toBe(0);
  });

  it("con context.guard.db (service-role, SIN sesión) por error -> la RPC rechaza (42501) y el contador NO avanza", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fx = await seedFixture({ featureOn: true, courseConfig: { enabled: true } });
    const context = buildContext(fx);
    const conversation = await getOrCreateConversation(context);

    // Uso INCORRECTO deliberado: `context.guard.db` en vez del cliente de sesión.
    await persistAssistantMessage(
      context,
      context.guard.db,
      conversation.id,
      "respuesta",
      [],
      { promptTokens: 1, completionTokens: 1, costUsd: 0.000001 },
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      "[tutor-ia] fallo registrando el uso diario (tutor_add_usage)",
      expect.anything(),
    );

    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await svc
      .from("tutor_usage_daily")
      .select("messages")
      .eq("tenant_id", fx.tenantId)
      .eq("user_id", fx.studentUserId)
      .eq("day", today)
      .maybeSingle();
    expect(usage).toBeNull();
    consoleSpy.mockRestore();
  });
});

describe("streamTutorAnswer — orquestación completa con aiClient inyectado (nunca red real)", () => {
  it("flujo feliz: deltas + final con citas + persistencia + ambas RPCs de uso/costo", async () => {
    const fx = await seedFixture({ featureOn: true, courseConfig: { enabled: true }, seedChunk: true });
    const context = buildContext(fx);
    const sessionDb = await studentSessionClient(fx.studentUserId, fx.tenantId);

    // Mismo orden que la request real: `route.ts` reserva el cupo ANTES de
    // invocar al proveedor de IA / `streamTutorAnswer`.
    const reserved = await reserveBudgetForContext(context, sessionDb);
    expect(reserved).toEqual({ ok: true });

    const aiClient = scriptedAiClient({
      chunks: [
        { type: "delta", text: "Los EPP " },
        { type: "delta", text: "reducen riesgos [1]." },
        { type: "done", usage: { promptTokens: 42, completionTokens: 18, costUsd: 0.00009 } },
      ],
    });

    const events = [];
    // Frase que calza LITERALMENTE con el contenido indexado (mismo criterio
    // que `tutor-retrieval.integration.test.ts`): determinista para el FTS
    // 'spanish' sin depender de qué stopwords descarte `websearch_to_tsquery`.
    for await (const evt of streamTutorAnswer(context, { aiClient, sessionDb }, "elementos de protección personal")) {
      events.push(evt);
    }

    expect(events.slice(0, 2)).toEqual([
      { type: "delta", text: "Los EPP " },
      { type: "delta", text: "reducen riesgos [1]." },
    ]);
    const final = events[2];
    expect(final?.type).toBe("final");
    if (final?.type !== "final") throw new Error("se esperaba un evento final");
    expect(final.citations).toEqual([{ lessonId: fx.lessonId, lessonTitle: "Elementos de protección personal" }]);
    expect(typeof final.conversationId).toBe("string");

    // Persistencia: 2 mensajes (user + assistant) en la conversación real.
    const { data: messages } = await svc
      .from("tutor_messages")
      .select("role, content")
      .eq("conversation_id", final.conversationId)
      .order("created_at", { ascending: true });
    expect(messages).toEqual([
      { role: "user", content: "elementos de protección personal" },
      { role: "assistant", content: "Los EPP reducen riesgos [1]." },
    ]);

    // Ambas RPCs de uso/costo vía el cliente de sesión.
    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await svc
      .from("tutor_usage_daily")
      .select("messages, input_tokens, output_tokens, cost_usd")
      .eq("tenant_id", fx.tenantId)
      .eq("user_id", fx.studentUserId)
      .eq("day", today)
      .maybeSingle();
    expect(usage?.messages).toBe(1);
    expect(usage?.input_tokens).toBe(42);
    expect(usage?.output_tokens).toBe(18);
    expect(Number(usage?.cost_usd)).toBeCloseTo(0.00009, 6);

    // Auditoría: metadata NO sensible, jamás la pregunta ni la respuesta.
    const { data: audit } = await svc
      .from("audit_log")
      .select("details")
      .eq("tenant_id", fx.tenantId)
      .eq("action", "tutor.message.sent")
      .eq("entity_id", final.conversationId);
    expect(audit).toHaveLength(1);
    expect(audit?.[0]?.details).toEqual({ mode: "lexical", citationsCount: 1, costUsd: 0.00009 });
    const detailsStr = JSON.stringify(audit?.[0]?.details);
    expect(detailsStr).not.toContain("EPP");
    expect(detailsStr).not.toContain("qué son");

    // El contador diario, consultado de nuevo, refleja el mensaje recién enviado.
    const budgetAfter = await checkBudgetForContext(context);
    expect(budgetAfter).toEqual({ ok: true });
  });

  it("error upstream a medio camino: SÍ persiste lo parcial y termina con {type:error} (nunca cuelga ni expone el error crudo)", async () => {
    const fx = await seedFixture({ featureOn: true, courseConfig: { enabled: true }, seedChunk: true });
    const context = buildContext(fx);
    const sessionDb = await studentSessionClient(fx.studentUserId, fx.tenantId);

    const reserved = await reserveBudgetForContext(context, sessionDb);
    expect(reserved).toEqual({ ok: true });

    const aiClient = scriptedAiClient({
      chunks: [
        { type: "delta", text: "Empezando a responder" },
        { type: "error", error: "openrouter_http_500" }, // detalle crudo del proveedor: NUNCA debe llegar al cliente
      ],
    });

    const events = [];
    for await (const evt of streamTutorAnswer(context, { aiClient, sessionDb }, "pregunta")) {
      events.push(evt);
    }

    expect(events).toEqual([
      { type: "delta", text: "Empezando a responder" },
      { type: "error", error: "upstream_error" }, // genérico, no "openrouter_http_500"
    ]);

    // Persistencia best-effort de lo parcial + el contador SIEMPRE avanza
    // (si no, un fallo de parseo permitiría eludir el límite diario reintentando).
    const { data: assistantMsg } = await svc
      .from("tutor_messages")
      .select("content")
      .eq("tenant_id", fx.tenantId)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(assistantMsg?.content).toBe("Empezando a responder");

    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await svc
      .from("tutor_usage_daily")
      .select("messages, input_tokens, output_tokens")
      .eq("tenant_id", fx.tenantId)
      .eq("user_id", fx.studentUserId)
      .eq("day", today)
      .maybeSingle();
    expect(usage?.messages).toBe(1);
    expect(usage?.input_tokens).toBe(0);
    expect(usage?.output_tokens).toBe(0);
  });

  it("test estrella de minimización EN EL PUNTO DE ENSAMBLAJE: ningún RUN/correo/apellido/empresa llega a los messages enviados al modelo", async () => {
    process.env.OPENROUTER_API_KEY = "test-dummy-key";
    const fx = await seedFixture({
      featureOn: true,
      courseConfig: { enabled: true },
      seedChunk: true,
      firstNames: "María José RUN 9.876.543-2 correo maria.jose@empresa-poison.cl",
      lastNames: "Rojas Contreras — Empresa Poison Ltda.",
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(await studentSessionClient(fx.studentUserId, fx.tenantId));
    const gate = await resolveTutorContext(studentPrincipal(fx.studentUserId, fx.tenantId));
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;

    const sessionDb = await studentSessionClient(fx.studentUserId, fx.tenantId);
    let capturedMessages: ChatMessage[] = [];
    const aiClient = scriptedAiClient({
      chunks: [
        { type: "delta", text: "Respuesta sobre EPP [1]." },
        { type: "done", usage: { promptTokens: 1, completionTokens: 1, costUsd: 0 } },
      ],
      captureMessages: (messages) => {
        capturedMessages = messages;
      },
    });

    for await (const _evt of streamTutorAnswer(gate.context, { aiClient, sessionDb }, "elementos de protección personal")) {
      void _evt;
    }

    const serialized = JSON.stringify(capturedMessages);
    // Patrones de RUN chileno, correo y los apellidos/empresa "envenenados":
    // NINGUNO debe sobrevivir el ensamblaje real del prompt.
    expect(serialized).not.toMatch(/\d{1,2}\.\d{3}\.\d{3}-[\dkK]/); // RUN con puntos
    expect(serialized).not.toMatch(/@empresa-poison\.cl/);
    expect(serialized).not.toContain("Rojas");
    expect(serialized).not.toContain("Contreras");
    expect(serialized).not.toContain("Poison");
    expect(serialized).toContain("María"); // el firstName SANEADO sí puede ir
  });
});
