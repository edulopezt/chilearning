/**
 * RLS del checklist de DJ (task 3.3, HU-5.6): staff del tenant lee
 * (otec_admin/coordinator/instructor); supervisor y alumno NO (cumplimiento SENCE
 * interno de la OTEC). Escritura solo por service_role. Aislamiento por tenant.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const ACTION_A = "ac000000-0000-4000-8000-000000000001";
const ENROLLMENT_A = "e0000000-0000-4000-8000-000000000001";
const ROW_ID = randomUUID();

interface LocalEnv { apiUrl: string; anonKey: string; serviceRoleKey: string; jwtSecret: string }
function loadLocalEnv(): LocalEnv {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => { const m = out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m")); if (!m?.[1]) throw new Error(`no ${k}`); return m[1]; };
  return { apiUrl: get("API_URL"), anonKey: get("ANON_KEY"), serviceRoleKey: get("SERVICE_ROLE_KEY"), jwtSecret: get("JWT_SECRET") };
}
let env: LocalEnv;
async function jwt(c: { sub: string; tenant_id?: string; roles: string[] }): Promise<string> {
  return new SignJWT({ role: "authenticated", ...(c.tenant_id ? { tenant_id: c.tenant_id } : {}), roles: c.roles })
    .setProtectedHeader({ alg: "HS256" }).setSubject(c.sub).setAudience("authenticated").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.jwtSecret));
}
function client(token?: string): SupabaseClient { return createClient(env.apiUrl, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: token ? { headers: { Authorization: `Bearer ${token}` } } : {} }); }
function svcClient(): SupabaseClient { return createClient(env.apiUrl, env.serviceRoleKey, { auth: { persistSession: false } }); }

beforeAll(async () => {
  env = loadLocalEnv();
  const ins = await svcClient().from("dj_checklist").insert({
    id: ROW_ID, tenant_id: TENANT_A, action_id: ACTION_A, enrollment_id: ENROLLMENT_A,
    state: "pendiente_emitir", settlement_deadline: "2026-08-30",
  });
  if (ins.error) throw new Error(`seed dj_checklist: ${ins.error.message}`);
});

describe("dj_checklist — lecturas por rol", () => {
  it("staff (otec_admin/coordinator/instructor) lee; supervisor y alumno NO", async () => {
    for (const role of ["otec_admin", "coordinator", "instructor"]) {
      const c = client(await jwt({ sub: "aaaaaaaa-0000-4000-8000-000000000001", tenant_id: TENANT_A, roles: [role] }));
      expect((await c.from("dj_checklist").select("id").eq("id", ROW_ID)).data ?? [], role).toHaveLength(1);
    }
    for (const role of ["supervisor", "student"]) {
      const c = client(await jwt({ sub: "aaaaaaaa-0000-4000-8000-000000000007", tenant_id: TENANT_A, roles: [role] }));
      expect((await c.from("dj_checklist").select("id").eq("id", ROW_ID)).data ?? [], role).toHaveLength(0);
    }
  });

  it("el tenant B no lo ve (aislamiento)", async () => {
    const c = client(await jwt({ sub: "bbbbbbbb-0000-4000-8000-000000000001", tenant_id: TENANT_B, roles: ["otec_admin"] }));
    expect((await c.from("dj_checklist").select("id").eq("id", ROW_ID)).data ?? []).toHaveLength(0);
  });
});

describe("dj_checklist — escritura solo por service_role", () => {
  it("ni otec_admin puede UPDATE por RLS (escritura vía servicio)", async () => {
    const c = client(await jwt({ sub: "aaaaaaaa-0000-4000-8000-000000000001", tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const upd = await c.from("dj_checklist").update({ state: "emitida" }).eq("id", ROW_ID).select("id");
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
  });

  it("otec_admin no puede INSERT por RLS", async () => {
    const c = client(await jwt({ sub: "aaaaaaaa-0000-4000-8000-000000000001", tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const ins = await c.from("dj_checklist").insert({ tenant_id: TENANT_A, action_id: ACTION_A, enrollment_id: ENROLLMENT_A, state: "pendiente_emitir" });
    expect(ins.error).not.toBeNull();
  });
});
