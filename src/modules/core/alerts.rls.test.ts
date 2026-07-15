/**
 * RLS de `alerts` (task 2.6): el staff correcto del tenant la lee, nadie del
 * cliente la escribe, y las alertas de plataforma (tenant NULL) son solo del
 * superadmin. Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const USER_A = (n: number): string => `aaaaaaaa-0000-4000-8000-00000000000${n}`;
const SUPERADMIN = "00000000-0000-4000-8000-00000000000a";

interface LocalEnv {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  jwtSecret: string;
}

function loadLocalEnv(): LocalEnv {
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

let env: LocalEnv;

async function jwt(claims: {
  sub: string;
  tenant_id?: string;
  roles: string[];
}): Promise<string> {
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
    .sign(new TextEncoder().encode(env.jwtSecret));
}

function client(token?: string): SupabaseClient {
  return createClient(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });
}

function serviceClient(): SupabaseClient {
  return createClient(env.apiUrl, env.serviceRoleKey, { auth: { persistSession: false } });
}

beforeAll(async () => {
  env = loadLocalEnv();
  const svc = serviceClient();
  // Siembra: una alerta del tenant A y una de plataforma (tenant NULL).
  const { error } = await svc.from("alerts").insert([
    {
      tenant_id: TENANT_A,
      kind: "sence_error_rate",
      severity: "warning",
      message: "Alerta de prueba RLS (tenant A)",
      details: { rate: 0.5 },
    },
    {
      tenant_id: null,
      kind: "sence_error_rate",
      severity: "critical",
      message: "Alerta de plataforma de prueba RLS",
      details: {},
    },
  ]);
  if (error) throw new Error(`seed alerts: ${error.message}`);
});

describe("alerts — lecturas por rol", () => {
  it("otec_admin del tenant A ve las alertas de su tenant (y ninguna de plataforma)", async () => {
    const c = client(await jwt({ sub: USER_A(1), tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const { data, error } = await c.from("alerts").select("tenant_id, message");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
    for (const row of (data ?? []) as { tenant_id: string | null }[]) {
      expect(row.tenant_id).toBe(TENANT_A);
    }
  });

  it("supervisor del tenant A también las ve (fiscalizador, HU-5.5)", async () => {
    const c = client(await jwt({ sub: USER_A(7), tenant_id: TENANT_A, roles: ["supervisor"] }));
    const { data, error } = await c.from("alerts").select("id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("otec_admin del tenant B NO ve las del tenant A (aislamiento)", async () => {
    const c = client(
      await jwt({ sub: "bbbbbbbb-0000-4000-8000-000000000001", tenant_id: TENANT_B, roles: ["otec_admin"] }),
    );
    const { data, error } = await c.from("alerts").select("tenant_id");
    expect(error).toBeNull();
    for (const row of (data ?? []) as { tenant_id: string | null }[]) {
      expect(row.tenant_id).toBe(TENANT_B);
    }
  });

  it("los demás roles del tenant NO leen alertas (deny-by-default)", async () => {
    for (const role of ["coordinator", "instructor", "tutor", "student", "company"]) {
      const c = client(await jwt({ sub: USER_A(2), tenant_id: TENANT_A, roles: [role] }));
      const { data } = await c.from("alerts").select("id");
      expect(data ?? []).toHaveLength(0);
    }
  });

  it("superadmin ve también las alertas de plataforma (tenant NULL)", async () => {
    const c = client(await jwt({ sub: SUPERADMIN, roles: ["superadmin"] }));
    const { data, error } = await c.from("alerts").select("tenant_id");
    expect(error).toBeNull();
    const tenants = ((data ?? []) as { tenant_id: string | null }[]).map((r) => r.tenant_id);
    expect(tenants).toContain(null);
  });
});

describe("alerts — el cliente no escribe", () => {
  it("INSERT/UPDATE/DELETE denegados para otec_admin (solo el servidor escribe)", async () => {
    const c = client(await jwt({ sub: USER_A(1), tenant_id: TENANT_A, roles: ["otec_admin"] }));

    const ins = await c.from("alerts").insert({
      tenant_id: TENANT_A,
      kind: "sence_error_rate",
      message: "no debería entrar",
    });
    expect(ins.error).not.toBeNull();

    const upd = await c
      .from("alerts")
      .update({ message: "hackeada" })
      .eq("tenant_id", TENANT_A)
      .select("id");
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);

    const del = await c.from("alerts").delete().eq("tenant_id", TENANT_A).select("id");
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);
  });
});
