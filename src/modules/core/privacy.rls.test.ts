/**
 * RLS de derechos Ley 21.719 (task 3.5): el titular ve/crea SOLO lo suyo; los
 * consentimientos son INSERT-only; el staff gestiona las solicitudes; el
 * supervisor no accede. Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const STUDENT_A = "aaaaaaaa-0000-4000-8000-000000000005";
const OTHER_A = "aaaaaaaa-0000-4000-8000-000000000006";

const DSR_ID = randomUUID();

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
  const c = await svc.from("consents").insert({ tenant_id: TENANT_A, user_id: STUDENT_A, policy_version: "2026-07" });
  if (c.error) throw new Error(`seed consent: ${c.error.message}`);
  const d = await svc.from("dsr_requests").insert({ id: DSR_ID, tenant_id: TENANT_A, user_id: STUDENT_A, kind: "erasure", detail: "por favor" });
  if (d.error) throw new Error(`seed dsr: ${d.error.message}`);
});

describe("privacy — lecturas por rol", () => {
  it("el titular ve su consentimiento y su solicitud; otro usuario no", async () => {
    const owner = client(await jwt({ sub: STUDENT_A, tenant_id: TENANT_A, roles: ["student"] }));
    expect((await owner.from("consents").select("id").eq("user_id", STUDENT_A)).data ?? []).not.toHaveLength(0);
    expect((await owner.from("dsr_requests").select("id").eq("id", DSR_ID)).data ?? []).toHaveLength(1);
    const other = client(await jwt({ sub: OTHER_A, tenant_id: TENANT_A, roles: ["student"] }));
    expect((await other.from("dsr_requests").select("id").eq("id", DSR_ID)).data ?? []).toHaveLength(0);
  });

  it("el otec_admin gestiona las solicitudes; el supervisor no las ve", async () => {
    const admin = client(await jwt({ sub: "aaaaaaaa-0000-4000-8000-000000000001", tenant_id: TENANT_A, roles: ["otec_admin"] }));
    expect((await admin.from("dsr_requests").select("id").eq("id", DSR_ID)).data ?? []).toHaveLength(1);
    const sup = client(await jwt({ sub: "aaaaaaaa-0000-4000-8000-000000000007", tenant_id: TENANT_A, roles: ["supervisor"] }));
    expect((await sup.from("dsr_requests").select("id").eq("id", DSR_ID)).data ?? []).toHaveLength(0);
  });

  it("aislamiento: el tenant B no ve la solicitud del tenant A", async () => {
    const b = client(await jwt({ sub: "bbbbbbbb-0000-4000-8000-000000000001", tenant_id: TENANT_B, roles: ["otec_admin"] }));
    expect((await b.from("dsr_requests").select("id").eq("id", DSR_ID)).data ?? []).toHaveLength(0);
  });
});

describe("privacy — consentimiento INSERT-only", () => {
  it("ni service_role puede UPDATE/DELETE un consentimiento", async () => {
    const svc = svcClient();
    const upd = await svc.from("consents").update({ policy_version: "hack" }).eq("user_id", STUDENT_A).select("id");
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
    const del = await svc.from("consents").delete().eq("user_id", STUDENT_A).select("id");
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);
  });
});
