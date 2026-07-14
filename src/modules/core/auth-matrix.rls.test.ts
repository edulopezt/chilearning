/**
 * Matriz de permisos con LOGINS REALES (HU-2.1, HU-2.3) — task 0.4.
 * A diferencia de isolation.rls.test.ts (que firma JWTs a mano), aquí se hace
 * login real vía Supabase Auth: prueba que el Auth Hook inyecta los claims
 * correctos y que el RLS los respeta de punta a punta. Requiere `supabase start`
 * + `supabase db reset` (con el hook habilitado en config.toml).
 */
import { execSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const PASSWORD = "Password123!";

interface LocalEnv {
  apiUrl: string;
  anonKey: string;
}

function loadEnv(): LocalEnv {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => {
    const m = out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"));
    if (!m?.[1]) throw new Error(`falta ${k}`);
    return m[1];
  };
  return { apiUrl: get("API_URL"), anonKey: get("ANON_KEY") };
}

let env: LocalEnv;

/** Hace login real y devuelve un cliente autenticado + los claims del JWT. */
async function login(email: string): Promise<{
  db: SupabaseClient;
  claims: { tenant_id?: string; roles?: string[]; memberships?: unknown };
}> {
  const db = createClient(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`login falló para ${email}: ${error?.message}`);
  const payloadB64 = data.session.access_token.split(".")[1]!;
  const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  return { db, claims };
}

beforeAll(() => {
  env = loadEnv();
});

describe("Auth Hook inyecta los claims correctos según la fuente de verdad", () => {
  it("otec_admin@A: tenant A + rol otec_admin", async () => {
    const { claims } = await login("admin@otec-andes.test");
    expect(claims.tenant_id).toBe(TENANT_A);
    expect(claims.roles).toEqual(["otec_admin"]);
  });

  it("student@B: tenant B + rol student", async () => {
    const { claims } = await login("alumno@otec-pacifico.test");
    expect(claims.tenant_id).toBe(TENANT_B);
    expect(claims.roles).toEqual(["student"]);
  });

  it("superadmin: rol superadmin y SIN tenant (transversal, D-006)", async () => {
    const { claims } = await login("superadmin@chilearning.test");
    expect(claims.roles).toEqual(["superadmin"]);
    expect(claims.tenant_id).toBeUndefined();
  });
});

describe("RLS con login real respeta la matriz (spec §3)", () => {
  it("otec_admin@A ve SOLO su tenant y su auditoría", async () => {
    const { db } = await login("admin@otec-andes.test");
    const tenants = await db.from("tenants").select("id");
    expect(tenants.data?.map((r) => r.id)).toEqual([TENANT_A]);

    const audit = await db.from("audit_log").select("tenant_id");
    expect(audit.error).toBeNull();
    expect(audit.data?.every((r) => r.tenant_id === TENANT_A)).toBe(true);
  });

  it("student@A NO lee la auditoría (matriz §3)", async () => {
    const { db } = await login("alumno@otec-andes.test");
    const audit = await db.from("audit_log").select("id");
    expect(audit.error).toBeNull();
    expect(audit.data).toEqual([]);
  });

  it("coordinator@A no puede escalar su membership a otec_admin (login real)", async () => {
    const { db } = await login("coordinacion@otec-andes.test");
    const { error } = await db
      .from("memberships")
      .update({ roles: ["otec_admin"] })
      .eq("tenant_id", TENANT_A);
    // Bloqueado: por el trigger de roles (o por no afectar filas ajenas).
    const affected = await db
      .from("memberships")
      .select("roles")
      .contains("roles", ["otec_admin"])
      .eq("tenant_id", TENANT_A);
    expect(error !== null || (affected.data?.length ?? 0) === 1).toBe(true);
  });

  it("superadmin ve ambos tenants (login real)", async () => {
    const { db } = await login("superadmin@chilearning.test");
    const tenants = await db.from("tenants").select("slug");
    expect(tenants.data?.map((r) => r.slug).sort()).toEqual(["otec-andes", "otec-pacifico"]);
  });

  it("student@A no ve las sesiones SENCE (no es staff)", async () => {
    const { db } = await login("alumno@otec-andes.test");
    const sessions = await db.from("sence_sessions").select("id");
    expect(sessions.error).toBeNull();
    expect(sessions.data).toEqual([]);
  });
});
