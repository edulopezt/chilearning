/**
 * RLS del expediente (task 3.12, HU-5.10): staff-only (sin supervisor/alumno,
 * trae montos comerciales); definitivos INMUTABLES incluso para service_role;
 * aislamiento por tenant. Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const ACTION_A = "ac000000-0000-4000-8000-000000000001";
const DOC_ID = randomUUID();

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
  const svc = svcClient();
  const ins = await svc.from("action_documents").insert({
    id: DOC_ID, tenant_id: TENANT_A, action_id: ACTION_A, doc_type: "dj", title: "DJ definitiva",
    is_definitive: true, status: "vigente", file_path: `${TENANT_A}/${ACTION_A}/${DOC_ID}-dj.pdf`,
    file_name: "dj.pdf", file_size: 1000, mime_type: "application/pdf", uploaded_by: "aaaaaaaa-0000-4000-8000-000000000001",
  });
  if (ins.error) throw new Error(`seed doc: ${ins.error.message}`);
});

describe("action_documents — lecturas por rol", () => {
  it("admin/coordinador lo leen; relator, supervisor y alumno NO (montos comerciales)", async () => {
    for (const role of ["otec_admin", "coordinator"]) {
      const c = client(await jwt({ sub: "aaaaaaaa-0000-4000-8000-000000000001", tenant_id: TENANT_A, roles: [role] }));
      expect((await c.from("action_documents").select("id").eq("id", DOC_ID)).data ?? []).toHaveLength(1);
    }
    for (const role of ["instructor", "supervisor", "student"]) {
      const c = client(await jwt({ sub: "aaaaaaaa-0000-4000-8000-000000000007", tenant_id: TENANT_A, roles: [role] }));
      expect((await c.from("action_documents").select("id").eq("id", DOC_ID)).data ?? []).toHaveLength(0);
    }
  });

  it("el tenant B no lo ve (aislamiento)", async () => {
    const c = client(await jwt({ sub: "bbbbbbbb-0000-4000-8000-000000000001", tenant_id: TENANT_B, roles: ["otec_admin"] }));
    expect((await c.from("action_documents").select("id").eq("id", DOC_ID)).data ?? []).toHaveLength(0);
  });
});

describe("action_documents — definitivo inmutable", () => {
  it("ni service_role puede UPDATE/DELETE un documento definitivo", async () => {
    const svc = svcClient();
    const upd = await svc.from("action_documents").update({ title: "hack" }).eq("id", DOC_ID).select("id");
    expect(upd.error).not.toBeNull();
    const del = await svc.from("action_documents").delete().eq("id", DOC_ID).select("id");
    expect(del.error).not.toBeNull();
  });
});
