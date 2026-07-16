/**
 * RLS de los grants de supervisor (task 3.11, HU-12.1/12.2). Prueba a nivel BD que
 * el fiscalizador solo ve datos con grant ACTIVO y EN ALCANCE:
 *   - sin grant / expirado / revocado  → 0 filas
 *   - grant de alcance 'actions'        → ve la acción concedida, NO otra
 *   - grant tenant activo               → ve el tenant
 * Y que sigue siendo SOLO LECTURA. Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const SUP_ACTIVE = "aaaaaaaa-0000-4000-8000-000000000007"; // grant tenant activo (semilla)
const ENR_USER = "aaaaaaaa-0000-4000-8000-000000000005"; // usuario semilla para las inscripciones
// Fiscalizadores de prueba: usuarios FRESCOS por corrida (evita colisión del índice
// único de grant vigente entre re-ejecuciones y no exige permiso de DELETE).
let SUP_NONE = "";
let SUP_EXPIRED = "";
let SUP_REVOKED = "";
let SUP_SCOPED = "";

const COURSE = randomUUID();
const ACTION_X = randomUUID();
const ACTION_Y = randomUUID();
const ENR_X = randomUUID();
const ENR_Y = randomUUID();

interface LocalEnv { apiUrl: string; anonKey: string; serviceRoleKey: string; jwtSecret: string }
function loadLocalEnv(): LocalEnv {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => { const m = out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m")); if (!m?.[1]) throw new Error(`no ${k}`); return m[1]; };
  return { apiUrl: get("API_URL"), anonKey: get("ANON_KEY"), serviceRoleKey: get("SERVICE_ROLE_KEY"), jwtSecret: get("JWT_SECRET") };
}
let env: LocalEnv;
async function jwt(sub: string, roles: string[], tenant = TENANT_A): Promise<string> {
  return new SignJWT({ role: "authenticated", tenant_id: tenant, roles })
    .setProtectedHeader({ alg: "HS256" }).setSubject(sub).setAudience("authenticated").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.jwtSecret));
}
function client(token: string): SupabaseClient { return createClient(env.apiUrl, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } }); }
function svc(): SupabaseClient { return createClient(env.apiUrl, env.serviceRoleKey, { auth: { persistSession: false } }); }
async function supClient(sub: string): Promise<SupabaseClient> { return client(await jwt(sub, ["supervisor"])); }

const past = "2020-01-01T00:00:00.000Z";

async function freshUser(db: SupabaseClient): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({ email: `sup-${randomUUID().slice(0, 12)}@t.cl`, email_confirm: true, password: `Sv-${randomUUID()}` });
  if (error || !data?.user) throw new Error(`createUser: ${error?.message ?? "sin id"}`);
  return data.user.id;
}

beforeAll(async () => {
  env = loadLocalEnv();
  const db = svc();
  [SUP_NONE, SUP_EXPIRED, SUP_REVOKED, SUP_SCOPED] = await Promise.all([freshUser(db), freshUser(db), freshUser(db), freshUser(db)]);

  await db.from("courses").insert({ id: COURSE, tenant_id: TENANT_A, name: "Curso 3.11", sence: true, cod_sence: "1234567890" });
  for (const [id, code] of [[ACTION_X, "SUP-X"], [ACTION_Y, "SUP-Y"]] as const) {
    await db.from("actions").insert({ id, tenant_id: TENANT_A, course_id: COURSE, codigo_accion: code, training_line: 3, environment: "rcetest" });
  }
  const enrX = await db.from("enrollments").insert({ id: ENR_X, tenant_id: TENANT_A, action_id: ACTION_X, user_id: ENR_USER, run: "5126663-3", first_names: "X", last_names: "X" });
  const enrY = await db.from("enrollments").insert({ id: ENR_Y, tenant_id: TENANT_A, action_id: ACTION_Y, user_id: ENR_USER, run: "6222444-9", first_names: "Y", last_names: "Y" });
  if (enrX.error || enrY.error) throw new Error(`seed enrollments: ${enrX.error?.message ?? enrY.error?.message}`);

  const g = (user: string, extra: Record<string, unknown>) => ({ tenant_id: TENANT_A, user_id: user, email: `${user}@t.cl`, ...extra });
  await db.from("supervisor_grants").insert(g(SUP_EXPIRED, { scope: "tenant", expires_at: past }));
  await db.from("supervisor_grants").insert(g(SUP_REVOKED, { scope: "tenant", revoked_at: past }));
  const scoped = await db.from("supervisor_grants").insert(g(SUP_SCOPED, { scope: "actions" })).select("id").single();
  if (scoped.error) throw new Error(`seed scoped grant: ${scoped.error.message}`);
  const ga = await db.from("supervisor_grant_actions").insert({ grant_id: scoped.data!.id, action_id: ACTION_X, tenant_id: TENANT_A });
  if (ga.error) throw new Error(`seed grant_actions: ${ga.error.message}`);

  // Alertas: una colgada de ACTION_Y (fuera de alcance de SUP_SCOPED) y una tenant-wide.
  const al = await db.from("alerts").insert([
    { tenant_id: TENANT_A, kind: "sence_day1_low_attendance", message: "y-scope-alert", action_id: ACTION_Y },
    { tenant_id: TENANT_A, kind: "sence_error_rate", message: "tenant-wide-alert", action_id: null },
  ]);
  if (al.error) throw new Error(`seed alerts: ${al.error.message}`);
});

async function countEnrollments(sub: string, actionId: string): Promise<number> {
  const c = await supClient(sub);
  const { data } = await c.from("enrollments").select("id").eq("action_id", actionId);
  return (data ?? []).length;
}

describe("supervisor_grants — vigencia gobierna la lectura", () => {
  it("grant tenant activo ve enrollments; sin grant / expirado / revocado NO", async () => {
    expect(await countEnrollments(SUP_ACTIVE, ACTION_X)).toBe(1);
    expect(await countEnrollments(SUP_NONE, ACTION_X)).toBe(0);
    expect(await countEnrollments(SUP_EXPIRED, ACTION_X)).toBe(0);
    expect(await countEnrollments(SUP_REVOKED, ACTION_X)).toBe(0);
  });

  it("grant scope=actions ve la acción concedida, NO otra del tenant", async () => {
    expect(await countEnrollments(SUP_SCOPED, ACTION_X)).toBe(1);
    expect(await countEnrollments(SUP_SCOPED, ACTION_Y)).toBe(0);
  });

  it("alertas: scope=actions NO ve la alerta de otra acción ni la tenant-wide; grant de tenant SÍ (4-ojos MED)", async () => {
    const scoped = await supClient(SUP_SCOPED);
    expect((await scoped.from("alerts").select("id").eq("action_id", ACTION_Y)).data ?? []).toHaveLength(0);
    expect((await scoped.from("alerts").select("id").is("action_id", null).eq("tenant_id", TENANT_A)).data ?? []).toHaveLength(0);
    const active = await supClient(SUP_ACTIVE);
    expect((await active.from("alerts").select("id").eq("action_id", ACTION_Y)).data?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect((await active.from("alerts").select("id").is("action_id", null).eq("tenant_id", TENANT_A)).data?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});

describe("supervisor_grants — aislamiento y solo-lectura", () => {
  it("el fiscalizador ve SU grant pero no puede escribirlo (service_role only)", async () => {
    const c = await supClient(SUP_ACTIVE);
    expect((await c.from("supervisor_grants").select("id").eq("user_id", SUP_ACTIVE)).data?.length ?? 0).toBeGreaterThanOrEqual(1);
    const ins = await c.from("supervisor_grants").insert({ tenant_id: TENANT_A, user_id: SUP_ACTIVE, email: "x@x.cl", scope: "tenant" });
    expect(ins.error).not.toBeNull();
    const upd = await c.from("supervisor_grants").update({ revoked_at: null }).eq("user_id", SUP_EXPIRED).select("id");
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
  });

  it("no ve grants de otros usuarios del tenant", async () => {
    const c = await supClient(SUP_ACTIVE);
    expect((await c.from("supervisor_grants").select("id").eq("user_id", SUP_SCOPED)).data ?? []).toHaveLength(0);
  });

  it("tenant B no ve los grants del tenant A", async () => {
    const c = client(await jwt("bbbbbbbb-0000-4000-8000-000000000001", ["otec_admin"], "22222222-2222-4222-8222-222222222222"));
    expect((await c.from("supervisor_grants").select("id").eq("tenant_id", TENANT_A)).data ?? []).toHaveLength(0);
  });
});
