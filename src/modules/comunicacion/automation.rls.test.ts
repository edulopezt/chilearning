/**
 * RLS de automatización (task 3.9): `automation_config` staff-only (escritura solo
 * service_role); `communication_opt_outs` auto-servicio (el alumno gestiona SOLO el
 * suyo, el staff lo lee). Aislamiento por tenant. Requiere `supabase db reset`.
 */
import { execSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const ACTION_A = "ac000000-0000-4000-8000-000000000001";
const STUDENT = "aaaaaaaa-0000-4000-8000-000000000005";
const OTHER = "aaaaaaaa-0000-4000-8000-000000000006";

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

beforeAll(async () => {
  env = loadLocalEnv();
  const db = svc();
  await db.from("automation_config").upsert({ tenant_id: TENANT_A, action_id: ACTION_A, kind: "no_attendance", enabled: true }, { onConflict: "action_id,kind" });
});

describe("automation_config — solo staff lee, nadie autenticado escribe", () => {
  it("otec_admin/coordinator leen; instructor/student/supervisor NO", async () => {
    for (const role of ["otec_admin", "coordinator"]) {
      const c = client(await jwt("aaaaaaaa-0000-4000-8000-000000000001", [role]));
      expect((await c.from("automation_config").select("id").eq("action_id", ACTION_A)).data?.length ?? 0, role).toBeGreaterThanOrEqual(1);
    }
    for (const role of ["instructor", "student", "supervisor"]) {
      const c = client(await jwt("aaaaaaaa-0000-4000-8000-000000000007", [role]));
      expect((await c.from("automation_config").select("id").eq("action_id", ACTION_A)).data ?? [], role).toHaveLength(0);
    }
  });

  it("ni otec_admin puede INSERT/UPDATE por RLS (config va por servicio)", async () => {
    const c = client(await jwt("aaaaaaaa-0000-4000-8000-000000000001", ["otec_admin"]));
    expect((await c.from("automation_config").insert({ tenant_id: TENANT_A, action_id: ACTION_A, kind: "inactive", enabled: true })).error).not.toBeNull();
    const upd = await c.from("automation_config").update({ enabled: false }).eq("action_id", ACTION_A).select("id");
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
  });

  it("tenant B no ve la config del tenant A", async () => {
    const c = client(await jwt("bbbbbbbb-0000-4000-8000-000000000001", ["otec_admin"], TENANT_B));
    expect((await c.from("automation_config").select("id").eq("action_id", ACTION_A)).data ?? []).toHaveLength(0);
  });
});

describe("communication_opt_outs — auto-servicio del alumno", () => {
  it("el alumno crea y borra SU opt-out; no toca el de otro", async () => {
    const me = client(await jwt(STUDENT, ["student"]));
    const ins = await me.from("communication_opt_outs").insert({ tenant_id: TENANT_A, user_id: STUDENT, channel: "email" });
    expect(ins.error).toBeNull();
    expect((await me.from("communication_opt_outs").select("id").eq("user_id", STUDENT)).data?.length ?? 0).toBeGreaterThanOrEqual(1);
    // No puede crear el opt-out de OTRO usuario.
    expect((await me.from("communication_opt_outs").insert({ tenant_id: TENANT_A, user_id: OTHER, channel: "email" })).error).not.toBeNull();
    // Se da de baja (delete propio).
    expect((await me.from("communication_opt_outs").delete().eq("user_id", STUDENT).eq("channel", "email").select("id")).error).toBeNull();
  });

  it("no ve el opt-out de otro alumno; el staff sí lee el del tenant", async () => {
    await svc().from("communication_opt_outs").upsert({ tenant_id: TENANT_A, user_id: OTHER, channel: "email" }, { onConflict: "tenant_id,user_id,channel", ignoreDuplicates: true });
    const me = client(await jwt(STUDENT, ["student"]));
    expect((await me.from("communication_opt_outs").select("id").eq("user_id", OTHER)).data ?? []).toHaveLength(0);
    const admin = client(await jwt("aaaaaaaa-0000-4000-8000-000000000001", ["otec_admin"]));
    expect((await admin.from("communication_opt_outs").select("id").eq("user_id", OTHER)).data?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});
