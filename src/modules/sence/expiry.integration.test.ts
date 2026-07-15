/**
 * Integración del WORKER DE EXPIRACIÓN (task 2.6) contra Supabase local:
 * `runExpiryTick` (T4/T6/T9 + auditoría + carreras) y `runErrorRateCheck`
 * (alerta por tenant con cooldown). Sin Redis: el tick se invoca directo, con
 * el reloj INYECTADO en el futuro (no se retro-datan filas).
 *
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { encryptToken, parseEncryptionKey } from "@/modules/sence/domain/token-crypto";
import { handleCallback, startSession, type EngineDeps } from "@/modules/sence/engine";
import { runErrorRateCheck, runExpiryTick } from "@/modules/sence/expiry";
import type { TenantGuard } from "@/lib/tenant-guard";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const DEMO_COURSE = "c0000000-0000-4000-8000-000000000001";
const STUDENT_A = "aaaaaaaa-0000-4000-8000-000000000005";
const VALID_TOKEN = "00000000-0000-4000-8000-000000000000";
const KEY = parseEncryptionKey(Buffer.from("0".repeat(32)).toString("base64"));

const HOUR = 3_600_000;
const MINUTE = 60_000;
const PENDING_TIMEOUT_MS = 60 * MINUTE;

let svc: SupabaseClient;

function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => {
    const m = out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"));
    if (!m?.[1]) throw new Error(`falta ${k}`);
    return m[1];
  };
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

function guardFor(tenantId: string): TenantGuard {
  return {
    tenantId,
    db: svc,
    from(table: string, tenantColumn = "tenant_id") {
      return svc.from(table).select("*").eq(tenantColumn, tenantId);
    },
    assertTenant(rowTenantId) {
      if (rowTenantId !== tenantId) throw new Error("cross-tenant");
    },
    withTenant(row) {
      return { ...row, tenant_id: tenantId };
    },
  };
}

/** Deps mínimas del motor: el worker no toca el token, pero startSession sí. */
function engineDeps(): EngineDeps {
  return {
    encryptionKey: KEY,
    callbackUrl: "http://127.0.0.1:9/api/sence/cb",
    now: () => Date.now(),
    newUuid: () => randomUUID(),
    newNonce: () => randomUUID().replace(/-/g, "").slice(0, 16),
  };
}

async function freshEnrollment(): Promise<string> {
  const actionId = randomUUID();
  await svc.from("actions").insert({
    id: actionId,
    tenant_id: TENANT_A,
    course_id: DEMO_COURSE,
    codigo_accion: "ACC-EXPIRY-TEST",
    training_line: 3,
    environment: "rcetest",
  });
  const enrollmentId = randomUUID();
  const { error } = await svc.from("enrollments").insert({
    id: enrollmentId,
    tenant_id: TENANT_A,
    action_id: actionId,
    user_id: STUDENT_A,
    run: "5126663-3",
  });
  if (error) throw new Error(`enrollment: ${error.message}`);
  return enrollmentId;
}

interface SeedSessionInput {
  status: "iniciada_pendiente" | "iniciada" | "cerrada" | "error";
  errorOrigin?: "start" | "close";
  expiresAt?: string | null;
  openedAt?: string | null;
  closedAt?: string | null;
  idSesionSence?: string | null;
}

/** Siembra una sesión como lo haría el motor (service_role), enrollment fresco. */
async function seedSession(input: SeedSessionInput): Promise<string> {
  const enrollmentId = await freshEnrollment();
  const { data, error } = await svc
    .from("sence_sessions")
    .insert({
      tenant_id: TENANT_A,
      enrollment_id: enrollmentId,
      action_code: "ACC-EXPIRY-TEST",
      training_line: 3,
      run_alumno: "5126663-3",
      id_sesion_alumno: `expiry-${randomUUID()}`,
      environment: "rcetest",
      status: input.status,
      error_origin: input.errorOrigin ?? null,
      expires_at: input.expiresAt ?? null,
      opened_at: input.openedAt ?? null,
      closed_at: input.closedAt ?? null,
      id_sesion_sence: input.idSesionSence ?? null,
      callback_nonce: `nonce-${randomUUID().slice(0, 8)}`,
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed sesión: ${error.message}`);
  return data.id as string;
}

async function sessionStatus(id: string): Promise<string> {
  const { data } = await svc.from("sence_sessions").select("status").eq("id", id).single();
  return (data as { status: string }).status;
}

async function expiryAudits(sessionId: string): Promise<{ details: Record<string, unknown> }[]> {
  const { data } = await svc
    .from("audit_log")
    .select("details")
    .eq("action", "sence.session_expired")
    .eq("entity_id", sessionId);
  return (data ?? []) as { details: Record<string, unknown> }[];
}

beforeAll(async () => {
  const e = env();
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
  // Token del OTEC (para los tests que pasan por startSession).
  await svc
    .from("sence_otec_config")
    .update({ token_encrypted: encryptToken(VALID_TOKEN, KEY) })
    .eq("tenant_id", TENANT_A);
});

describe("runExpiryTick — T4 (abandono de Clave Única)", () => {
  it("expira una pendiente que superó el timeout y audita la transición", async () => {
    const sessionId = await seedSession({ status: "iniciada_pendiente" });
    const summary = await runExpiryTick(svc, {
      now: Date.now() + PENDING_TIMEOUT_MS + MINUTE,
      pendingTimeoutMs: PENDING_TIMEOUT_MS,
    });
    expect(summary.expired.T4).toBeGreaterThanOrEqual(1);
    expect(await sessionStatus(sessionId)).toBe("expirada");

    const audits = await expiryAudits(sessionId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.details.transition).toBe("T4");
  });

  it("NO toca una pendiente fresca (deadline no vencido)", async () => {
    const sessionId = await seedSession({ status: "iniciada_pendiente" });
    await runExpiryTick(svc, { now: Date.now(), pendingTimeoutMs: PENDING_TIMEOUT_MS });
    expect(await sessionStatus(sessionId)).toBe("iniciada_pendiente");
  });

  it("desbloquea el enrollment 'brickeado' por el índice único parcial", async () => {
    // 1. El alumno inicia y abandona Clave Única (queda pendiente, sin callback).
    const enrollmentId = await freshEnrollment();
    const guard = guardFor(TENANT_A);
    const first = await startSession(guard, enrollmentId, STUDENT_A, engineDeps());
    expect(first.kind).toBe("ready");

    // 2. Reintento con la pendiente viva: el índice único lo bloquea (el brick).
    await expect(startSession(guard, enrollmentId, STUDENT_A, engineDeps())).rejects.toThrow();

    // 3. El worker expira la abandonada (T4)...
    await runExpiryTick(svc, {
      now: Date.now() + PENDING_TIMEOUT_MS + MINUTE,
      pendingTimeoutMs: PENDING_TIMEOUT_MS,
    });

    // 4. ...y el alumno puede volver a iniciar asistencia.
    const retry = await startSession(guard, enrollmentId, STUDENT_A, engineDeps());
    expect(retry.kind).toBe("ready");
  });
});

describe("runExpiryTick — T6/T9 (vencimiento de expires_at)", () => {
  it("T6: iniciada con expires_at vencido → expirada + audit", async () => {
    const sessionId = await seedSession({
      status: "iniciada",
      idSesionSence: "998877",
      openedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await runExpiryTick(svc, { now: Date.now(), pendingTimeoutMs: PENDING_TIMEOUT_MS });
    expect(await sessionStatus(sessionId)).toBe("expirada");
    const audits = await expiryAudits(sessionId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.details.transition).toBe("T6");
  });

  it("T9: error(close) con expires_at vencido → expirada", async () => {
    const sessionId = await seedSession({
      status: "error",
      errorOrigin: "close",
      idSesionSence: "998878",
      openedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await runExpiryTick(svc, { now: Date.now(), pendingTimeoutMs: PENDING_TIMEOUT_MS });
    expect(await sessionStatus(sessionId)).toBe("expirada");
    const audits = await expiryAudits(sessionId);
    expect(audits[0]?.details.transition).toBe("T9");
  });

  it("contraejemplos: error(start) terminal, cerrada e iniciada vigente quedan intactos", async () => {
    const errorStart = await seedSession({ status: "error", errorOrigin: "start" });
    const cerrada = await seedSession({
      status: "cerrada",
      closedAt: new Date().toISOString(),
    });
    const vigente = await seedSession({
      status: "iniciada",
      idSesionSence: "998879",
      openedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3 * HOUR).toISOString(),
    });

    await runExpiryTick(svc, { now: Date.now(), pendingTimeoutMs: PENDING_TIMEOUT_MS });

    expect(await sessionStatus(errorStart)).toBe("error");
    expect(await sessionStatus(cerrada)).toBe("cerrada");
    expect(await sessionStatus(vigente)).toBe("iniciada");
  });

  it("carrera con callback tardío: la expirada NO revive y el evento queda late (I-15)", async () => {
    const nonce = `late-${randomUUID().slice(0, 8)}`;
    const idSesionAlumno = `expiry-late-${randomUUID()}`;
    const enrollmentId = await freshEnrollment();
    const { data } = await svc
      .from("sence_sessions")
      .insert({
        tenant_id: TENANT_A,
        enrollment_id: enrollmentId,
        action_code: "ACC-EXPIRY-TEST",
        training_line: 3,
        run_alumno: "5126663-3",
        id_sesion_alumno: idSesionAlumno,
        environment: "rcetest",
        status: "iniciada",
        id_sesion_sence: "556677",
        opened_at: new Date().toISOString(),
        expires_at: new Date(Date.now() - 1000).toISOString(),
        callback_nonce: nonce,
      })
      .select("id")
      .single();
    const sessionId = (data as { id: string }).id;

    // El worker gana la carrera: expira primero.
    await runExpiryTick(svc, { now: Date.now(), pendingTimeoutMs: PENDING_TIMEOUT_MS });
    expect(await sessionStatus(sessionId)).toBe("expirada");

    // Llega el cierre tardío real: se persiste como evidencia, no revive nada.
    const result = await handleCallback(
      svc,
      {
        IdSesionAlumno: idSesionAlumno,
        FechaHora: new Date().toISOString().slice(0, 19).replace("T", " "),
      },
      engineDeps(),
      nonce,
    );
    expect(result.persisted).toBe(true);
    expect(result.late).toBe(true);
    expect(await sessionStatus(sessionId)).toBe("expirada");
  });

  it("doble tick concurrente: una sola transición y UNA sola entrada de auditoría", async () => {
    const sessionId = await seedSession({
      status: "iniciada",
      idSesionSence: "998880",
      openedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const now = Date.now();
    await Promise.all([
      runExpiryTick(svc, { now, pendingTimeoutMs: PENDING_TIMEOUT_MS }),
      runExpiryTick(svc, { now, pendingTimeoutMs: PENDING_TIMEOUT_MS }),
    ]);
    expect(await sessionStatus(sessionId)).toBe("expirada");
    expect(await expiryAudits(sessionId)).toHaveLength(1);
  });
});

describe("runErrorRateCheck — alerta de tasa de error por tenant×ambiente", () => {
  // Reloj VIRTUAL futuro y monotónico por-corrida: aísla la ventana tanto de
  // los eventos reales del resto de la suite como de los eventos/alertas que
  // dejaron CORRIDAS ANTERIORES (sence_events es INSERT-only: no se pueden
  // limpiar). Amplificar ×1000 separa dos corridas reales a segundos de
  // distancia en horas de tiempo virtual (> ventana + cooldown).
  const VIRTUAL_EPOCH = Date.parse("2026-01-01T00:00:00Z");
  const T0 = VIRTUAL_EPOCH + (Date.now() - VIRTUAL_EPOCH) * 1000;
  const WINDOW_MS = 10 * MINUTE;
  const POLICY = { threshold: 0.2, minEvents: 5 };
  const STUDENT_B = "bbbbbbbb-0000-4000-8000-000000000005";

  // La tasa separa rcetest de rce vía join a la sesión (R-2): los eventos del
  // fixture cuelgan de sesiones reales con ambiente, como en producción.
  let sessionA = ""; // tenant A, rcetest
  let sessionB = ""; // tenant B, rcetest

  async function seedFixtureSession(
    tenantId: string,
    userId: string,
    courseId: string,
  ): Promise<string> {
    const actionId = randomUUID();
    await svc.from("actions").insert({
      id: actionId,
      tenant_id: tenantId,
      course_id: courseId,
      codigo_accion: "ACC-ALERT-TEST",
      training_line: 3,
      environment: "rcetest",
    });
    const enrollmentId = randomUUID();
    await svc.from("enrollments").insert({
      id: enrollmentId,
      tenant_id: tenantId,
      action_id: actionId,
      user_id: userId,
      run: "5126663-3",
    });
    const { data, error } = await svc
      .from("sence_sessions")
      .insert({
        tenant_id: tenantId,
        enrollment_id: enrollmentId,
        action_code: "ACC-ALERT-TEST",
        training_line: 3,
        run_alumno: "5126663-3",
        id_sesion_alumno: `alert-${randomUUID()}`,
        environment: "rcetest",
        status: "cerrada",
        closed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(`seed sesión alerta: ${error.message}`);
    return (data as { id: string }).id;
  }

  beforeAll(async () => {
    const courseB = randomUUID();
    await svc
      .from("courses")
      .insert({ id: courseB, tenant_id: TENANT_B, name: "Curso alertas B", sence: false });
    sessionA = await seedFixtureSession(TENANT_A, STUDENT_A, DEMO_COURSE);
    sessionB = await seedFixtureSession(TENANT_B, STUDENT_B, courseB);
  });

  async function seedEvent(
    tenantId: string,
    sessionId: string,
    kind: string,
    at: number,
  ): Promise<void> {
    const { error } = await svc.from("sence_events").insert({
      tenant_id: tenantId,
      session_id: sessionId,
      kind,
      payload: {},
      error_codes: kind.endsWith("_error") ? ["100"] : [],
      dedupe_hash: `expiry-test-${randomUUID()}`,
      received_at: new Date(at).toISOString(),
    });
    if (error) throw new Error(`seed evento: ${error.message}`);
  }

  it("alerta al tenant×ambiente sobre el umbral, respeta cooldown y no alerta al sano", async () => {
    // Tenant A: 4 errores / 6 eventos = 67% (sobre umbral, sobre mínimo).
    for (const kind of ["start_error", "start_error", "close_error", "start_error"]) {
      await seedEvent(TENANT_A, sessionA, kind, T0 - MINUTE);
    }
    await seedEvent(TENANT_A, sessionA, "start_ok", T0 - MINUTE);
    await seedEvent(TENANT_A, sessionA, "close_ok", T0 - MINUTE);
    // Tenant B: solo éxitos.
    for (let i = 0; i < 6; i += 1) await seedEvent(TENANT_B, sessionB, "start_ok", T0 - MINUTE);

    const first = await runErrorRateCheck(svc, {
      now: T0,
      windowMs: WINDOW_MS,
      policy: POLICY,
    });
    expect(first.alerted).toContainEqual({ tenantId: TENANT_A, environment: "rcetest" });
    expect(first.alerted.some((g) => g.tenantId === TENANT_B)).toBe(false);

    const { data: alertRows } = await svc
      .from("alerts")
      .select("kind, severity, message, details, tenant_id")
      .eq("tenant_id", TENANT_A)
      .eq("kind", "sence_error_rate")
      .gte("created_at", new Date(T0 - WINDOW_MS).toISOString());
    expect(alertRows).toHaveLength(1);
    const [alert] = alertRows as {
      message: string;
      details: { errors: number; environment: string };
    }[];
    expect(alert?.message).toContain("Tasa de errores SENCE");
    expect(alert?.message).toContain("rcetest");
    expect(alert?.details.errors).toBe(4);
    expect(alert?.details.environment).toBe("rcetest");

    // Segunda pasada inmediata: cooldown, sin alerta duplicada.
    const second = await runErrorRateCheck(svc, {
      now: T0 + MINUTE,
      windowMs: WINDOW_MS,
      policy: POLICY,
    });
    expect(second.alerted.some((g) => g.tenantId === TENANT_A)).toBe(false);
    expect(second.cooledDown).toContainEqual({ tenantId: TENANT_A, environment: "rcetest" });
  });

  it("NO alerta bajo el mínimo de eventos aunque todos sean errores", async () => {
    // Reloj virtual PROPIO con amplificación ×2000 (no un offset fijo de T0):
    // un offset constante colisiona con el T0 de OTRA corrida cuando la
    // separación real ≈ offset/1000 (banda de ~1 s — llegó a ocurrir). Con
    // factores distintos, los relojes de corridas vecinas nunca se cruzan.
    const t1 = VIRTUAL_EPOCH + (Date.now() - VIRTUAL_EPOCH) * 2000;
    for (let i = 0; i < 4; i += 1) await seedEvent(TENANT_B, sessionB, "start_error", t1 - MINUTE);
    const result = await runErrorRateCheck(svc, {
      now: t1,
      windowMs: WINDOW_MS,
      policy: POLICY,
    });
    expect(result.alerted.some((g) => g.tenantId === TENANT_B)).toBe(false);
  });
});
