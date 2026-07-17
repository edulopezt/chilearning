/**
 * RLS de la vigencia de certificados (task 5.12, HU-7.3).
 *
 * Qué fija, a nivel BD (no de servicio):
 *  - la config de alertas y el ledger de avisos son dato del STAFF: el alumno no
 *    los ve, y el staff del tenant A no ve los del B (RNF-1);
 *  - el ledger es INSERT-only y `authenticated` NO puede escribirlo: si un
 *    usuario pudiera borrar una fila, podría hacerse re-notificar a voluntad; si
 *    pudiera insertarla, podría SILENCIAR el aviso de su propia recertificación.
 *
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const USER_STUDENT_A = "aaaaaaaa-0000-4000-8000-000000000005";
const USER_ADMIN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_COMPANY_A = "aaaaaaaa-0000-4000-8000-000000000006";

// Fixtures propios (ids frescos por corrida: re-ejecutable sin colisión).
const COURSE_A = randomUUID();
const ACTION_A = randomUUID();
const ENR_A = randomUUID();
const CERT_A = randomUUID();
const COURSE_B = randomUUID();
const ACTION_B = randomUUID();
const ENR_B = randomUUID();
const CERT_B = randomUUID();
let USER_WORKER_A = "";
let USER_WORKER_B = "";

interface LocalEnv { apiUrl: string; anonKey: string; serviceRoleKey: string; jwtSecret: string }
let env: LocalEnv;

function loadLocalEnv(): LocalEnv {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (key: string): string => {
    const match = out.match(new RegExp(`^${key}="?([^"\\r\\n]+)"?$`, "m"));
    if (!match?.[1]) throw new Error(`supabase status no expone ${key}; ¿corriste supabase start?`);
    return match[1];
  };
  return { apiUrl: get("API_URL"), anonKey: get("ANON_KEY"), serviceRoleKey: get("SERVICE_ROLE_KEY"), jwtSecret: get("JWT_SECRET") };
}

async function jwt(sub: string, roles: string[], tenant: string): Promise<string> {
  return new SignJWT({ role: "authenticated", tenant_id: tenant, roles })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.jwtSecret));
}
function client(token: string): SupabaseClient {
  return createClient(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
function svc(): SupabaseClient {
  return createClient(env.apiUrl, env.serviceRoleKey, { auth: { persistSession: false } });
}
async function clientAs(sub: string, roles: string[], tenant = TENANT_A): Promise<SupabaseClient> {
  return client(await jwt(sub, roles, tenant));
}
function unwrap(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`${label}: ${error.message}`);
}
async function freshUser(db: SupabaseClient): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({
    email: `exprls-${randomUUID().slice(0, 12)}@t.cl`, email_confirm: true, password: `Ex-${randomUUID()}`,
  });
  if (error || !data?.user) throw new Error(`createUser: ${error?.message ?? "sin id"}`);
  return data.user.id;
}

/** Certificado con vencimiento + su fila de alerta, en el tenant indicado. */
async function seedCert(
  db: SupabaseClient,
  t: { tenantId: string; courseId: string; actionId: string; enrollmentId: string; certId: string; userId: string },
): Promise<void> {
  unwrap("seed curso", (await db.from("courses").insert({
    id: t.courseId, tenant_id: t.tenantId, name: "Curso 5.12 RLS", sence: false, hours: 4, validity_months: 12,
  })).error);
  unwrap("seed acción", (await db.from("actions").insert({
    id: t.actionId, tenant_id: t.tenantId, course_id: t.courseId,
    codigo_accion: `RLS-${randomUUID().slice(0, 6)}`, training_line: 3, environment: "rcetest",
  })).error);
  unwrap("seed inscripción", (await db.from("enrollments").insert({
    id: t.enrollmentId, tenant_id: t.tenantId, action_id: t.actionId, user_id: t.userId,
    run: "5126663-3", first_names: "Ana", last_names: "Silva",
  })).error);
  unwrap("seed certificado", (await db.from("certificates").insert({
    id: t.certId, tenant_id: t.tenantId, enrollment_id: t.enrollmentId, action_id: t.actionId,
    course_id: t.courseId, folio: `CERT-RLS-${randomUUID().slice(0, 8)}`,
    verification_token: randomUUID().replace(/-/g, ""),
    snapshot: { studentName: "Silva, Ana", courseName: "Curso 5.12 RLS" },
    expires_at: "2026-10-15T00:00:00.000Z",
  })).error);
  unwrap("seed alerta", (await db.from("certificate_expiry_alerts").insert({
    tenant_id: t.tenantId, certificate_id: t.certId, offset_days: 90,
  })).error);
}

beforeAll(async () => {
  env = loadLocalEnv();
  const db = svc();
  [USER_WORKER_A, USER_WORKER_B] = await Promise.all([freshUser(db), freshUser(db)]);

  await seedCert(db, { tenantId: TENANT_A, courseId: COURSE_A, actionId: ACTION_A, enrollmentId: ENR_A, certId: CERT_A, userId: USER_WORKER_A });
  await seedCert(db, { tenantId: TENANT_B, courseId: COURSE_B, actionId: ACTION_B, enrollmentId: ENR_B, certId: CERT_B, userId: USER_WORKER_B });

  // Config en ambos tenants: sin una fila del B, "A no ve la del B" sería cierto por vacío.
  unwrap("config A", (await db.from("certificate_expiry_config").upsert(
    { tenant_id: TENANT_A, offsets_days: [90, 60, 30], enabled: true }, { onConflict: "tenant_id" },
  )).error);
  unwrap("config B", (await db.from("certificate_expiry_config").upsert(
    { tenant_id: TENANT_B, offsets_days: [45], enabled: true }, { onConflict: "tenant_id" },
  )).error);
});

afterAll(async () => {
  // Limpieza de lo que la BD permite borrar: el residuo en A rompería a las
  // suites que afirman sobre listas completas según el orden de archivos.
  const db = svc();
  try {
    await db.from("certificate_expiry_config").delete().in("tenant_id", [TENANT_A, TENANT_B]);
  } finally {
    // `certificates` y `certificate_expiry_alerts` NO tienen DELETE ni para el
    // service_role (son ledgers, por diseño — P8), y la FK `restrict` de
    // certificates impide además borrar su inscripción/acción/curso. El residuo
    // es INERTE: ids ALEATORIOS por corrida (sin colisión de unique) y ninguna
    // otra suite cuenta filas globales de esas tablas.
  }
});

describe("certificate_expiry_config — dato del staff, por tenant", () => {
  it("★ el ALUMNO no lee la config de alertas (es política interna del OTEC)", async () => {
    const db = await clientAs(USER_STUDENT_A, ["student"]);
    const { data, error } = await db.from("certificate_expiry_config").select("tenant_id, offsets_days");
    expect(error).toBeNull();
    expect(data ?? [], "el alumno no debe ver la config").toEqual([]);
  });

  it("★ el coordinador SÍ lee la config de SU tenant (no es una negación global)", async () => {
    // Sin esta aserción, toda la suite pasaría con un `using (false)`.
    const db = await clientAs(USER_ADMIN_A, ["coordinator"]);
    const { data, error } = await db.from("certificate_expiry_config").select("tenant_id, offsets_days, enabled");
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.tenant_id)).toEqual([TENANT_A]);
    expect((data ?? [])[0]!.offsets_days).toEqual([90, 60, 30]);
  });

  it("★ otec_admin@A no ve la config del tenant B (RNF-1), ni pidiéndola por id", async () => {
    const db = await clientAs(USER_ADMIN_A, ["otec_admin"]);
    const all = await db.from("certificate_expiry_config").select("tenant_id");
    expect((all.data ?? []).some((r) => r.tenant_id === TENANT_B), "fuga: ve la config del tenant B").toBe(false);

    const direct = await db.from("certificate_expiry_config").select("tenant_id, offsets_days").eq("tenant_id", TENANT_B);
    expect(direct.error).toBeNull();
    expect(direct.data ?? []).toEqual([]);
  });

  it("la empresa (rol company) tampoco lee la config del OTEC", async () => {
    const db = await clientAs(USER_COMPANY_A, ["company"]);
    expect((await db.from("certificate_expiry_config").select("tenant_id")).data ?? []).toEqual([]);
  });

  it("★ ningún rol escribe la config por tabla (solo el servicio, que autoriza y audita)", async () => {
    for (const roles of [["otec_admin"], ["coordinator"], ["student"]]) {
      const db = await clientAs(USER_ADMIN_A, roles);
      const ins = await db.from("certificate_expiry_config").insert({ tenant_id: TENANT_A, offsets_days: [1], enabled: true });
      expect(ins.error, `${roles[0]} no debería poder insertar config`).not.toBeNull();
      const upd = await db.from("certificate_expiry_config").update({ enabled: false }).eq("tenant_id", TENANT_A).select("tenant_id");
      expect(upd.error !== null || (upd.data ?? []).length === 0, `${roles[0]} no debería poder actualizar config`).toBe(true);
    }
    // Y la config quedó intacta.
    const { data } = await svc().from("certificate_expiry_config").select("enabled, offsets_days").eq("tenant_id", TENANT_A).single();
    expect(data!.enabled).toBe(true);
    expect(data!.offsets_days).toEqual([90, 60, 30]);
  });
});

describe("certificate_expiry_alerts — ledger de staff, INSERT-only", () => {
  it("★ el ALUMNO no lee el ledger de avisos", async () => {
    const db = await clientAs(USER_STUDENT_A, ["student"]);
    const { data, error } = await db.from("certificate_expiry_alerts").select("id, certificate_id");
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("★ el titular del certificado TAMPOCO lee el ledger (ve su aviso en notifications)", async () => {
    const db = await clientAs(USER_WORKER_A, ["student"]);
    const { data } = await db.from("certificate_expiry_alerts").select("id").eq("certificate_id", CERT_A);
    expect(data ?? []).toEqual([]);
  });

  it("★ otec_admin@A ve SUS alertas y NINGUNA del tenant B", async () => {
    const db = await clientAs(USER_ADMIN_A, ["otec_admin"]);
    const { data, error } = await db.from("certificate_expiry_alerts").select("certificate_id, tenant_id");
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.certificate_id);
    expect(ids, "el admin debe ver la alerta de su tenant").toContain(CERT_A);
    expect(ids, "fuga: ve la alerta del tenant B").not.toContain(CERT_B);
    expect((data ?? []).every((r) => r.tenant_id === TENANT_A)).toBe(true);
  });

  it("★ authenticated NO puede INSERTAR en el ledger (silenciaría su propio aviso)", async () => {
    // El insert de `(certId, 60)` haría que el job crea que ya avisó y se salte
    // el recordatorio de los 60 días. Por eso el ledger es solo del service_role.
    for (const roles of [["student"], ["otec_admin"], ["coordinator"]]) {
      const db = await clientAs(USER_WORKER_A, roles);
      const { error } = await db.from("certificate_expiry_alerts").insert({
        tenant_id: TENANT_A, certificate_id: CERT_A, offset_days: 60,
      });
      expect(error, `${roles[0]} no debería poder insertar en el ledger`).not.toBeNull();
    }
    // Y no se coló ninguna: sigue solo la del seed.
    const { data } = await svc().from("certificate_expiry_alerts").select("offset_days").eq("certificate_id", CERT_A);
    expect((data ?? []).map((r) => r.offset_days)).toEqual([90]);
  });

  it("★ authenticated NO puede BORRAR ni ACTUALIZAR el ledger (re-spam / falsear la bitácora)", async () => {
    const db = await clientAs(USER_ADMIN_A, ["otec_admin"]);
    const del = await db.from("certificate_expiry_alerts").delete().eq("certificate_id", CERT_A).select("id");
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);
    const upd = await db.from("certificate_expiry_alerts").update({ offset_days: 30 }).eq("certificate_id", CERT_A).select("id");
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);

    const { data } = await svc().from("certificate_expiry_alerts").select("offset_days").eq("certificate_id", CERT_A);
    expect((data ?? []).map((r) => r.offset_days), "el ledger se modificó").toEqual([90]);
  });

  it("★ el ledger es INSERT-only incluso para el service_role (P8: no se reescribe)", async () => {
    // Es la misma regla de `sence_events` y `audit_log`. Si el worker pudiera
    // borrar, un bug podría re-notificar en bucle.
    const db = svc();
    const del = await db.from("certificate_expiry_alerts").delete().eq("certificate_id", CERT_A).select("id");
    expect(del.error !== null || (del.data ?? []).length === 0, "el service_role NO debe poder borrar el ledger").toBe(true);
    const upd = await db.from("certificate_expiry_alerts").update({ offset_days: 30 }).eq("certificate_id", CERT_A).select("id");
    expect(upd.error !== null || (upd.data ?? []).length === 0, "el service_role NO debe poder actualizar el ledger").toBe(true);
  });

  it("el unique (certificate_id, offset_days) es lo que da la idempotencia del job", async () => {
    const { error } = await svc().from("certificate_expiry_alerts").insert({
      tenant_id: TENANT_A, certificate_id: CERT_A, offset_days: 90,
    });
    expect(error?.code, "un aviso repetido debe chocar con el unique (23505)").toBe("23505");
  });
});

describe("certificates.expires_at — la vigencia no debilita lo que ya existía", () => {
  it("el titular sigue viendo su certificado (con su vencimiento) y no el ajeno", async () => {
    const db = await clientAs(USER_WORKER_A, ["student"]);
    const { data, error } = await db.from("certificates").select("id, expires_at").in("id", [CERT_A, CERT_B]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([CERT_A]);
    expect((data ?? [])[0]!.expires_at).not.toBeNull();
  });

  it("★ nadie puede correr su propio vencimiento por tabla (ni el titular)", async () => {
    const db = await clientAs(USER_WORKER_A, ["student"]);
    const upd = await db.from("certificates").update({ expires_at: "2099-01-01T00:00:00.000Z" }).eq("id", CERT_A).select("id");
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);

    const { data } = await svc().from("certificates").select("expires_at").eq("id", CERT_A).single();
    expect(data!.expires_at, "el alumno extendió la vigencia de su certificado").toBe("2026-10-15T00:00:00+00:00");
  });
});
