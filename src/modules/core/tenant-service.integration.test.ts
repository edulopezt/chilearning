/**
 * Integración del ciclo de vida de tenants (task 5.3, HU-1.1/1.4/1.3): alta con
 * admin inicial + invitación, suspensión/reactivación (RPC pública y Auth Hook
 * endurecido) y feature flags. Requiere `supabase start` + `supabase db reset`
 * (los tenants creados NO se pueden borrar: audit_log es INSERT-only con FK).
 * Datos 100% ficticios.
 */
import { execSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "@/modules/core/domain/rbac";
import {
  createTenant,
  listTenants,
  reactivateTenant,
  setTenantFlags,
  suspendTenant,
} from "@/modules/core/tenant-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";

const superadmin: Principal = {
  userId: "00000000-0000-4000-8000-00000000000a",
  tenantId: null,
  roles: ["superadmin"],
};
const otecAdmin: Principal = {
  userId: "aaaaaaaa-0000-4000-8000-000000000001",
  tenantId: TENANT_A,
  roles: ["otec_admin"],
};

// Slug/correo únicos por corrida: el tenant creado no puede borrarse (FK de
// audit_log + INSERT-only), así que cada corrida usa su propio sufijo.
const RUN = Date.now().toString(36);
const SLUG = `otec-h5-${RUN}`;
const ADMIN_EMAIL = `admin-${RUN}@otec-h5.chilearning.test`;

let svc: SupabaseClient;
let anon: SupabaseClient;
let createdTenantId: string;
let createdAdminUserId: string;

beforeAll(() => {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string) => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  process.env.NEXT_PUBLIC_SUPABASE_URL = get("API_URL");
  process.env.SUPABASE_SERVICE_ROLE_KEY = get("SERVICE_ROLE_KEY");
  svc = createClient(get("API_URL"), get("SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  anon = createClient(get("API_URL"), get("ANON_KEY"), { auth: { persistSession: false } });
});

/** Invoca el hook como lo haría GoTrue y devuelve los claims resultantes. */
async function hookClaims(userId: string): Promise<Record<string, unknown>> {
  const { data, error } = await svc.rpc("custom_access_token_hook", {
    event: { user_id: userId, claims: { role: "authenticated" } },
  });
  expect(error).toBeNull();
  return (data as { claims: Record<string, unknown> }).claims;
}

describe("createTenant (HU-1.1)", () => {
  it("un otec_admin NO puede crear tenants (forbidden)", async () => {
    const r = await createTenant(otecAdmin, {
      name: "Pirata", slug: "otec-pirata-x", plan: "standard", adminEmail: "p@p.test",
    });
    expect(r).toEqual({ ok: false, error: "forbidden" });
  });

  it("rechaza un slug reservado ('admin') como invalid", async () => {
    const r = await createTenant(superadmin, {
      name: "Reservada", slug: "admin", plan: "standard", adminEmail: ADMIN_EMAIL,
    });
    expect(r).toEqual({ ok: false, error: "invalid" });
  });

  it("crea el tenant: fila + membership otec_admin + inviteLink + audit", async () => {
    const r = await createTenant(superadmin, {
      name: "OTEC H5 de Prueba", slug: SLUG, plan: "pro", adminEmail: ADMIN_EMAIL, rut: "76999999-9",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    createdTenantId = r.tenantId;
    expect(r.slug).toBe(SLUG);
    // Degrada sin RESEND_API_KEY: enlace copiable presente, correo no enviado.
    expect(r.inviteLink).not.toBeNull();
    expect(r.emailSent).toBe(false);

    // Fila con configuración por defecto segura (flags apagados).
    const { data: tenant } = await svc.from("tenants").select("slug, plan, status, flags").eq("id", r.tenantId).single();
    expect(tenant?.slug).toBe(SLUG);
    expect(tenant?.plan).toBe("pro");
    expect(tenant?.status).toBe("active");
    expect(tenant?.flags).toEqual({ scorm: false, ai_tutor: false, whatsapp: false });

    // Membership otec_admin del admin inicial.
    const { data: members } = await svc.from("memberships").select("user_id, roles, status").eq("tenant_id", r.tenantId);
    expect(members?.length).toBe(1);
    expect(members?.[0]?.roles).toEqual(["otec_admin"]);
    expect(members?.[0]?.status).toBe("active");
    createdAdminUserId = members![0]!.user_id as string;

    // Traza en audit_log (P8).
    const { data: audit } = await svc
      .from("audit_log")
      .select("action, actor_user_id, details")
      .eq("tenant_id", r.tenantId)
      .eq("action", "tenant.created");
    expect(audit?.length).toBe(1);
    expect(audit?.[0]?.actor_user_id).toBe(superadmin.userId);
    expect((audit?.[0]?.details as { slug?: string }).slug).toBe(SLUG);
  });

  it("un slug duplicado devuelve slug_taken (sin fila fantasma)", async () => {
    const r = await createTenant(superadmin, {
      name: "Duplicada", slug: SLUG, plan: "standard", adminEmail: ADMIN_EMAIL,
    });
    expect(r).toEqual({ ok: false, error: "slug_taken" });
    const { data } = await svc.from("tenants").select("id").eq("slug", SLUG);
    expect(data?.length).toBe(1);
  });

  it("rechaza un admin que YA pertenece a otra OTEC (admin_email_taken, 4-ojos)", async () => {
    // Sin selección de tenant por sesión (Hito 1), una segunda membership
    // dejaría al usuario con roles [] en TODOS sus tenants (hook multi-tenant).
    const r = await createTenant(superadmin, {
      name: "Segunda OTEC", slug: `${SLUG}-b`, plan: "standard", adminEmail: ADMIN_EMAIL,
    });
    expect(r).toEqual({ ok: false, error: "admin_email_taken" });

    // Rollback compensatorio: sin fila fantasma del segundo tenant…
    const { data: ghost } = await svc.from("tenants").select("id").eq("slug", `${SLUG}-b`);
    expect(ghost?.length).toBe(0);
    // …y el usuario conserva UNA sola membership (la original intacta).
    const { data: member } = await svc.from("memberships").select("id").eq("user_id", createdAdminUserId);
    expect(member?.length).toBe(1);

    // Su login sigue funcionando contra el tenant original (hook intacto).
    const claims = await hookClaims(createdAdminUserId);
    expect(claims.roles).toEqual(["otec_admin"]);
    expect(claims.tenant_id).toBe(createdTenantId);
  });
});

describe("suspensión y reactivación (HU-1.4)", () => {
  it("el hook emite los roles de la membership con el tenant ACTIVO", async () => {
    const claims = await hookClaims(createdAdminUserId);
    expect(claims.roles).toEqual(["otec_admin"]);
    expect(claims.tenant_id).toBe(createdTenantId);
  });

  it("suspend => RPC pública reporta suspended => reactivate => active", async () => {
    expect(await suspendTenant(superadmin, createdTenantId)).toEqual({ ok: true });
    const suspended = await anon.rpc("tenant_status_by_slug", { p_slug: SLUG });
    expect(suspended.error).toBeNull();
    expect(suspended.data).toBe("suspended");

    // Login de usuario de tenant suspendido: claims SIN roles (falla cerrado).
    const claims = await hookClaims(createdAdminUserId);
    expect(claims.roles).toEqual([]);
    expect(claims.tenant_id).toBeUndefined();

    expect(await reactivateTenant(superadmin, createdTenantId)).toEqual({ ok: true });
    const active = await anon.rpc("tenant_status_by_slug", { p_slug: SLUG });
    expect(active.data).toBe("active");

    // Y el login vuelve solo (1 clic, sin tocar datos).
    const restored = await hookClaims(createdAdminUserId);
    expect(restored.roles).toEqual(["otec_admin"]);
  });

  it("ambas acciones dejan traza en audit_log", async () => {
    const { data } = await svc
      .from("audit_log")
      .select("action")
      .eq("tenant_id", createdTenantId)
      .in("action", ["tenant.suspended", "tenant.reactivated"]);
    const actions = (data ?? []).map((r) => r.action);
    expect(actions).toContain("tenant.suspended");
    expect(actions).toContain("tenant.reactivated");
  });

  it("un otec_admin no puede suspender ni reactivar", async () => {
    expect(await suspendTenant(otecAdmin, createdTenantId)).toEqual({ ok: false, error: "forbidden" });
    expect(await reactivateTenant(otecAdmin, createdTenantId)).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("feature flags (HU-1.3)", () => {
  it("setTenantFlags mergea sobre los flags actuales y audita", async () => {
    expect(await setTenantFlags(superadmin, createdTenantId, { scorm: true })).toEqual({ ok: true });
    const { data } = await svc.from("tenants").select("flags").eq("id", createdTenantId).single();
    expect(data?.flags).toEqual({ scorm: true, ai_tutor: false, whatsapp: false });

    const { data: audit } = await svc
      .from("audit_log")
      .select("action")
      .eq("tenant_id", createdTenantId)
      .eq("action", "tenant.flags_updated");
    expect((audit ?? []).length).toBeGreaterThan(0);
  });

  it("rechaza flags malformados (clave desconocida / valor string)", async () => {
    expect(await setTenantFlags(superadmin, createdTenantId, { video: true })).toEqual({ ok: false, error: "invalid" });
    expect(await setTenantFlags(superadmin, createdTenantId, { scorm: "true" })).toEqual({ ok: false, error: "invalid" });
  });

  it("un otec_admin no puede tocar flags", async () => {
    expect(await setTenantFlags(otecAdmin, createdTenantId, { scorm: false })).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("listTenants (plataforma)", () => {
  it("el superadmin ve el tenant creado con sus flags normalizados", async () => {
    const list = await listTenants(superadmin);
    expect(list).not.toBeNull();
    const mine = list!.find((t) => t.id === createdTenantId);
    expect(mine?.slug).toBe(SLUG);
    expect(mine?.status).toBe("active");
    expect(mine?.flags.scorm).toBe(true);
    expect(mine?.flags.ai_tutor).toBe(false);
  });

  it("un otec_admin recibe null (forbidden)", async () => {
    expect(await listTenants(otecAdmin)).toBeNull();
  });
});
