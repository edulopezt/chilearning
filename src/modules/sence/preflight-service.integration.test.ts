/**
 * Integración del pre-flight de acción (task 2.7, HU-5.8) contra Supabase
 * local: checklist masivo (GATE: detecta RUN inválidos plantados), guía Clave
 * Única (envío real con sender fake + marca manual, ambas auditadas) y alerta
 * de día-1 en el tick del worker. Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { TenantGuard } from "@/lib/tenant-guard";
import { localIsoDate } from "@/modules/sence/domain/day1";
import { encryptToken, parseEncryptionKey } from "@/modules/sence/domain/token-crypto";
import { runDay1Check } from "@/modules/sence/expiry";
import { getActionPreflight } from "@/modules/sence/preflight-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
// Curso PROPIO del suite (no el demo): inscribir usuarios seed en acciones del
// curso demo contamina los tests de progreso, que asumen quién está inscrito.
let fixtureCourse = "";
// user_ids del seed (tenant A): distintos por inscripción (unique action+user).
const USER_TUTOR = "aaaaaaaa-0000-4000-8000-000000000004";
const USER_STUDENT = "aaaaaaaa-0000-4000-8000-000000000005";
const USER_COMPANY = "aaaaaaaa-0000-4000-8000-000000000006";
const USER_ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const KEY = parseEncryptionKey(Buffer.from("0".repeat(32)).toString("base64"));

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

interface SeedActionInput {
  startsOn?: string | null;
  endsOn?: string | null;
  codigo?: string;
}

async function seedAction(input: SeedActionInput = {}): Promise<string> {
  const id = randomUUID();
  const { error } = await svc.from("actions").insert({
    id,
    tenant_id: TENANT_A,
    course_id: fixtureCourse,
    codigo_accion: input.codigo ?? "PRE-2026-0715",
    training_line: 3,
    environment: "rcetest",
    starts_on: input.startsOn ?? "2099-01-01",
    ends_on: input.endsOn ?? "2099-01-31",
  });
  if (error) throw new Error(`seed acción: ${error.message}`);
  return id;
}

async function seedEnrollment(
  actionId: string,
  userId: string,
  run: string,
  exento = false,
): Promise<string> {
  const id = randomUUID();
  const { error } = await svc.from("enrollments").insert({
    id,
    tenant_id: TENANT_A,
    action_id: actionId,
    user_id: userId,
    run,
    exento,
  });
  if (error) throw new Error(`seed inscripción: ${error.message}`);
  return id;
}

beforeAll(async () => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  process.env.SENCE_TOKEN_ENCRYPTION_KEY = Buffer.from("0".repeat(32)).toString("base64");
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
  // Token del OTEC configurado (como en producción tras el panel 1.2).
  await svc
    .from("sence_otec_config")
    .update({ token_encrypted: encryptToken("00000000-0000-4000-8000-000000000000", KEY) })
    .eq("tenant_id", TENANT_A);
  // Curso propio del suite (con código SENCE válido para el checklist).
  fixtureCourse = randomUUID();
  const { error } = await svc.from("courses").insert({
    id: fixtureCourse,
    tenant_id: TENANT_A,
    name: "Curso preflight",
    sence: true,
    cod_sence: "1237999888",
  });
  if (error) throw new Error(`seed curso: ${error.message}`);
});

describe("getActionPreflight — checklist masivo (GATE: RUN plantados)", () => {
  it("detecta exactamente los RUN inválidos plantados y clasifica exentos como warning", async () => {
    const actionId = await seedAction();
    await seedEnrollment(actionId, USER_STUDENT, "5126663-3"); // válido
    const badId = await seedEnrollment(actionId, USER_TUTOR, "12345678-9"); // DV malo
    await seedEnrollment(actionId, USER_COMPANY, "9876543-2", true); // exento, DV malo

    const result = await getActionPreflight(guardFor(TENANT_A), actionId);
    if (!result.ok) throw new Error(result.error);
    const { view } = result;

    expect(view.totals).toEqual({ enrolled: 3, exempt: 1, invalid: 2 });
    const runsItem = view.checklist.items.find((i) => i.id === "runs");
    expect(runsItem?.status).toBe("error"); // hay un no-exento inválido
    const invalid = new Map(view.checklist.invalidRuns.map((r) => [r.enrollmentId, r]));
    expect(invalid.get(badId)?.rule).toBe("run_dv");
    expect(invalid.get(badId)?.exento).toBe(false);
    expect(view.checklist.overall).toBe("error");

    // Config del OTEC completa: token y RUT en verde.
    expect(view.checklist.items.find((i) => i.id === "config_token")?.status).toBe("ok");
    expect(view.checklist.items.find((i) => i.id === "config_rut_otec")?.status).toBe("ok");
  });

  it("una acción de OTRO tenant es not_found (aislamiento)", async () => {
    const actionId = await seedAction();
    const result = await getActionPreflight(guardFor(TENANT_B), actionId);
    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});

describe("checklist — lee la marca de guía desde audit_log", () => {
  it("sin marca → warning; con marca (la escribe comunicacion) → ok", async () => {
    const actionId = await seedAction();
    await seedEnrollment(actionId, USER_STUDENT, "5126663-3");

    const before = await getActionPreflight(guardFor(TENANT_A), actionId);
    if (!before.ok) throw new Error(before.error);
    expect(
      before.view.checklist.items.find((i) => i.id === "clave_unica_guide")?.status,
    ).toBe("warning");

    // La escritura real la hace el servicio de comunicación (I-16: este módulo
    // solo LEE la marca); aquí se simula su efecto insertando la fila de audit.
    await svc.from("audit_log").insert({
      tenant_id: TENANT_A,
      actor_user_id: USER_ADMIN,
      action: "sence.guide_sent",
      entity: "actions",
      entity_id: actionId,
      details: { sent: 1, failed: 0, skipped: 0 },
    });

    const after = await getActionPreflight(guardFor(TENANT_A), actionId);
    if (!after.ok) throw new Error(after.error);
    expect(after.view.checklist.items.find((i) => i.id === "clave_unica_guide")?.status).toBe(
      "ok",
    );
    expect(after.view.guideSentAt).not.toBeNull();
  });
});

describe("runDay1Check — alerta de asistencia baja el día 1 (fase 3 del tick)", () => {
  it("alerta cuando el ratio queda bajo el umbral, con cooldown por acción", async () => {
    const seedTime = Date.now();
    const today = localIsoDate(seedTime, "America/Santiago");
    const codigo = `DAY1-${randomUUID().slice(0, 8)}`;
    const actionId = await seedAction({ startsOn: today, endsOn: today, codigo });
    const withSession = await seedEnrollment(actionId, USER_STUDENT, "5126663-3");
    await seedEnrollment(actionId, USER_TUTOR, "16032460-0"); // sin sesión hoy

    // El alumno 1 SÍ registró hoy (sesión iniciada).
    const { error } = await svc.from("sence_sessions").insert({
      tenant_id: TENANT_A,
      enrollment_id: withSession,
      action_code: codigo,
      training_line: 3,
      run_alumno: "5126663-3",
      id_sesion_alumno: `day1-${randomUUID()}`,
      environment: "rcetest",
      status: "iniciada",
      id_sesion_sence: "424242",
      opened_at: new Date(seedTime).toISOString(),
      expires_at: new Date(seedTime + 3 * 3_600_000).toISOString(),
    });
    if (error) throw new Error(`seed sesión día-1: ${error.message}`);

    // `now` DESPUÉS de sembrar: la ventana [now-24h, now] debe incluir la
    // sesión (created_at lo pone la BD al insertar).
    const now = Date.now();
    // ratio = 1/2 = 0.5 < 0.6 → alerta. evalHourLocal 0 = evaluar siempre.
    const first = await runDay1Check(svc, { now, threshold: 0.6, evalHourLocal: 0 });
    expect(first.alerted).toContain(codigo);

    const { data: alertRows } = await svc
      .from("alerts")
      .select("message, details, action_id")
      .eq("kind", "sence_day1_low_attendance")
      .eq("action_id", actionId);
    expect(alertRows).toHaveLength(1);
    expect(alertRows?.[0]?.message).toContain(codigo);

    // Segunda pasada: cooldown de 24 h por acción.
    const second = await runDay1Check(svc, {
      now: now + 60_000,
      threshold: 0.6,
      evalHourLocal: 0,
    });
    expect(second.alerted).not.toContain(codigo);
    expect(second.cooledDown).toContain(codigo);

    // Y el pre-flight muestra la alerta de día-1.
    const view = await getActionPreflight(guardFor(TENANT_A), actionId);
    if (!view.ok) throw new Error(view.error);
    expect(view.view.day1Alert?.message).toContain(codigo);
  });

  it("antes de la hora de corte NO evalúa; sobre el umbral NO alerta", async () => {
    const seedTime = Date.now();
    const today = localIsoDate(seedTime, "America/Santiago");
    const codigo = `DAY1-OK-${randomUUID().slice(0, 8)}`;
    const actionId = await seedAction({ startsOn: today, endsOn: today, codigo });
    const enrolled = await seedEnrollment(actionId, USER_COMPANY, "5126663-3");
    const { error } = await svc.from("sence_sessions").insert({
      tenant_id: TENANT_A,
      enrollment_id: enrolled,
      action_code: codigo,
      training_line: 3,
      run_alumno: "5126663-3",
      id_sesion_alumno: `day1ok-${randomUUID()}`,
      environment: "rcetest",
      status: "cerrada",
      closed_at: new Date(seedTime).toISOString(),
    });
    if (error) throw new Error(`seed sesión día-1 ok: ${error.message}`);

    const now = Date.now(); // después de sembrar (ver test anterior)
    // evalHourLocal 24 > cualquier hora local → no se evalúa nada.
    const early = await runDay1Check(svc, { now, threshold: 0.6, evalHourLocal: 24 });
    expect(early.evaluated).toBe(0);

    // ratio 1/1 = 1 ≥ 0.6 → sin alerta.
    const ok = await runDay1Check(svc, { now, threshold: 0.6, evalHourLocal: 0 });
    expect(ok.alerted).not.toContain(codigo);
  });
});
