/**
 * RLS de `tenant_branding_by_slug` (task 6.6, Hito 6): RPC pública que el
 * shell de la app usa para co-brandear por subdominio ANTES de saber si hay
 * sesión. Debe exponer SOLO nombre + los 3 campos de `branding` de tenants
 * ACTIVOS — nunca la tabla cruda, nunca un tenant suspendido. Requiere
 * `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  return { apiUrl: get("API_URL"), anonKey: get("ANON_KEY"), serviceKey: get("SERVICE_ROLE_KEY"), jwtSecret: get("JWT_SECRET") };
}

let env: LocalEnv;
let svc: SupabaseClient;
let anon: SupabaseClient;

async function studentClient(): Promise<SupabaseClient> {
  const token = await new SignJWT({ role: "authenticated", roles: ["student"] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("dddddddd-0000-4000-8000-000000000001")
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.jwtSecret));
  return createClient(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// slug: check ^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$ (máx. 30 chars, migración core_foundation).
const activeSlug = `br-active-${Date.now().toString(36)}`;
const suspendedSlug = `br-susp-${Date.now().toString(36)}`;
let activeTenantId: string;
let suspendedTenantId: string;

beforeAll(async () => {
  env = loadLocalEnv();
  svc = createClient(env.apiUrl, env.serviceKey, { auth: { persistSession: false } });
  anon = createClient(env.apiUrl, env.anonKey, { auth: { persistSession: false } });

  const { data: active, error: activeErr } = await svc
    .from("tenants")
    .insert({
      slug: activeSlug,
      name: "OTEC Branding RLS (ficticio)",
      branding: { primaryColor: "#123456", accentColor: "#abcdef", logoUrl: "https://example.com/logo.png" },
    })
    .select("id")
    .single();
  expect(activeErr).toBeNull();
  activeTenantId = active!.id as string;

  const { data: suspended, error: suspendedErr } = await svc
    .from("tenants")
    .insert({
      slug: suspendedSlug,
      name: "OTEC Branding RLS Suspendido (ficticio)",
      status: "suspended",
      branding: { primaryColor: "#654321", accentColor: "#fedcba" },
    })
    .select("id")
    .single();
  expect(suspendedErr).toBeNull();
  suspendedTenantId = suspended!.id as string;
});

afterAll(async () => {
  await svc.from("tenants").delete().in("id", [activeTenantId, suspendedTenantId]);
});

describe("tenant_branding_by_slug: pública pero mínima (task 6.6)", () => {
  it("anon recibe SOLO nombre + los 3 campos de branding de un tenant activo", async () => {
    const { data, error } = await anon.rpc("tenant_branding_by_slug", { p_slug: activeSlug }).maybeSingle();
    expect(error).toBeNull();
    expect(data).toEqual({
      name: "OTEC Branding RLS (ficticio)",
      primary_color: "#123456",
      accent_color: "#abcdef",
      logo_url: "https://example.com/logo.png",
    });
    // Ninguna columna extra de `tenants` (id, rut, status, flags, slug...) se filtra.
    expect(Object.keys(data as object).sort()).toEqual(["accent_color", "logo_url", "name", "primary_color"]);
  });

  it("anon NO recibe branding de un tenant SUSPENDIDO (0 filas, no error)", async () => {
    const { data, error } = await anon.rpc("tenant_branding_by_slug", { p_slug: suspendedSlug }).maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("anon recibe 0 filas para un slug inexistente", async () => {
    const { data, error } = await anon
      .rpc("tenant_branding_by_slug", { p_slug: "no-existe-jamas" })
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("anon sigue SIN poder leer la tabla tenants directamente (branding incluido)", async () => {
    const { data, error } = await anon.from("tenants").select("id, branding").eq("id", activeTenantId);
    expect(error).not.toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("un usuario autenticado también puede consultarla (no exige rol otec_admin, a diferencia de getBrandingState)", async () => {
    const db = await studentClient();
    const { data, error } = await db.rpc("tenant_branding_by_slug", { p_slug: activeSlug }).maybeSingle();
    expect(error).toBeNull();
    expect((data as { primary_color: string } | null)?.primary_color).toBe("#123456");
  });
});
