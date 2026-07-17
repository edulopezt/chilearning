/**
 * RLS del ciclo de vida de tenants (task 5.3, HU-1.1/1.4): la suspensión y el
 * alta de tenants son potestad EXCLUSIVA del superadmin/servidor; la RPC de
 * estado por slug es pública pero solo expone el enum. Requiere
 * `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

interface LocalEnv {
  apiUrl: string;
  anonKey: string;
  serviceKey: string;
  jwtSecret: string;
}

function loadLocalEnv(): LocalEnv {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (key: string): string => {
    const match = out.match(new RegExp(`^${key}="?([^"\\r\\n]+)"?$`, "m"));
    if (!match?.[1]) throw new Error(`supabase status no expone ${key}; ¿está corriendo supabase start?`);
    return match[1];
  };
  return {
    apiUrl: get("API_URL"),
    anonKey: get("ANON_KEY"),
    serviceKey: get("SERVICE_ROLE_KEY"),
    jwtSecret: get("JWT_SECRET"),
  };
}

let env: LocalEnv;

async function mintJwt(claims: { sub: string; tenant_id?: string; roles?: string[] }): Promise<string> {
  return new SignJWT({
    role: "authenticated",
    ...(claims.tenant_id ? { tenant_id: claims.tenant_id } : {}),
    roles: claims.roles ?? [],
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.jwtSecret));
}

function clientFor(token?: string): SupabaseClient {
  return createClient(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });
}

async function clientAs(tenant: "a" | "b", role: string): Promise<SupabaseClient> {
  const idx = ["otec_admin", "coordinator", "instructor", "tutor", "student", "company", "supervisor"].indexOf(role) + 1;
  const prefix = tenant === "a" ? "aaaaaaaa" : "bbbbbbbb";
  return clientFor(
    await mintJwt({
      sub: `${prefix}-0000-4000-8000-00000000000${idx}`,
      tenant_id: tenant === "a" ? TENANT_A : TENANT_B,
      roles: [role],
    }),
  );
}

beforeAll(() => {
  env = loadLocalEnv();
});

describe("solo la plataforma administra tenants (HU-1.1/1.4)", () => {
  it("otec_admin@A NO puede suspender su tenant (update status: 0 filas o error)", async () => {
    const db = await clientAs("a", "otec_admin");
    const { data, error } = await db
      .from("tenants")
      .update({ status: "suspended" })
      .eq("id", TENANT_A)
      .select("id");
    expect(error !== null || (data ?? []).length === 0).toBe(true);

    // El tenant sigue activo (nada cambió por debajo).
    const status = await db.rpc("tenant_status_by_slug", { p_slug: "seminarea" });
    expect(status.data).toBe("active");
  });

  it("otec_admin@A NO puede insertar tenants", async () => {
    const db = await clientAs("a", "otec_admin");
    const { error } = await db.from("tenants").insert({ slug: "otec-rls-pirata", name: "Pirata" });
    expect(error).not.toBeNull();
  });

  it("otec_admin@A NO puede encenderse flags (update flags: 0 filas o error)", async () => {
    const db = await clientAs("a", "otec_admin");
    const { data, error } = await db
      .from("tenants")
      .update({ flags: { scorm: true } })
      .eq("id", TENANT_A)
      .select("id");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("student@A no ve el tenant B", async () => {
    const db = await clientAs("a", "student");
    const { data, error } = await db.from("tenants").select("id");
    expect(error).toBeNull();
    expect(data?.map((r) => r.id)).toEqual([TENANT_A]);
  });
});

describe("la suspensión corta el plano de datos con el JWT YA emitido (4-ojos)", () => {
  // El hook solo actúa al EMITIR tokens: este test prueba que jwt_tenant_id()
  // corta en la BD un access token vigente (ventana de hasta 1 h) al suspender,
  // y que la reactivación restaura el MISMO token sin re-login. Usa un tenant
  // PROPIO (no los del seed: otros archivos RLS corren en paralelo sobre ellos).
  it("un token vigente pierde TODO al suspender y vuelve al reactivar", async () => {
    const svc = createClient(env.apiUrl, env.serviceKey, { auth: { persistSession: false } });
    const slug = `otec-rls-susp-${Date.now().toString(36)}`;
    const { data: created, error: insertErr } = await svc
      .from("tenants")
      .insert({ slug, name: "OTEC RLS Suspensión (ficticia)" })
      .select("id")
      .single();
    expect(insertErr).toBeNull();
    const tenantId = created!.id as string;

    // Token acuñado ANTES de la suspensión (sigue vigente 1 h).
    const db = clientFor(
      await mintJwt({
        sub: "cccccccc-0000-4000-8000-000000000001",
        tenant_id: tenantId,
        roles: ["otec_admin"],
      }),
    );

    // Con el tenant activo, el token opera.
    const before = await db.from("tenants").select("id").eq("id", tenantId);
    expect(before.error).toBeNull();
    expect(before.data?.length).toBe(1);

    // Suspensión: el MISMO token deja de ver todo AL INSTANTE (jwt_tenant_id
    // devuelve NULL => toda policy de negocio deniega, sin esperar el refresh).
    await svc.from("tenants").update({ status: "suspended" }).eq("id", tenantId);
    const during = await db.from("tenants").select("id").eq("id", tenantId);
    expect(during.error).toBeNull();
    expect(during.data ?? []).toEqual([]);
    const memberships = await db.from("memberships").select("id");
    expect(memberships.data ?? []).toEqual([]);

    // Reactivación en 1 clic: el mismo token vuelve a operar sin re-login.
    await svc.from("tenants").update({ status: "active" }).eq("id", tenantId);
    const after = await db.from("tenants").select("id").eq("id", tenantId);
    expect(after.data?.length).toBe(1);
  });
});

describe("tenant_status_by_slug: pública pero mínima", () => {
  it("anon puede ejecutarla y recibe SOLO el enum de estado", async () => {
    const db = clientFor();
    const { data, error } = await db.rpc("tenant_status_by_slug", { p_slug: "seminarea" });
    expect(error).toBeNull();
    expect(data).toBe("active");
  });

  it("anon recibe null para un slug inexistente (sin filtrar nada más)", async () => {
    const db = clientFor();
    const { data, error } = await db.rpc("tenant_status_by_slug", { p_slug: "no-existe-jamas" });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("anon sigue SIN poder leer la tabla tenants directamente", async () => {
    const db = clientFor();
    const { data, error } = await db.from("tenants").select("id");
    expect(error).not.toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("un usuario autenticado también puede consultarla", async () => {
    const db = await clientAs("a", "student");
    const { data, error } = await db.rpc("tenant_status_by_slug", { p_slug: "otec-pacifico" });
    expect(error).toBeNull();
    expect(data).toBe("active");
  });
});
