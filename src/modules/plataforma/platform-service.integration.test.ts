/**
 * Integración del tablero superadmin (task 5.5, HU-10.3): agregados coherentes
 * sobre el seed y soporte AUDITADO. Requiere `supabase start` + `supabase db
 * reset`. Datos 100% ficticios.
 *
 * `getPlatformOverview` se ejerce con el cliente de SESIÓN del usuario (JWT real
 * firmado aquí), no con el service-role: así el gate 42501 de la RPC se prueba
 * de verdad. En la app ese cliente lo pone `createSupabaseServerClient()`
 * (cookies); aquí se inyecta por `deps.rpc` porque `next/headers` no existe
 * fuera de una request.
 */
import { execSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "@/modules/core/domain/rbac";
import { getPlatformOverview, recordTenantSupportView } from "@/modules/plataforma/platform-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const SUPERADMIN_ID = "00000000-0000-4000-8000-00000000000a";

const superadmin: Principal = { userId: SUPERADMIN_ID, tenantId: null, roles: ["superadmin"] };
const otecAdmin: Principal = {
  userId: "aaaaaaaa-0000-4000-8000-000000000001",
  tenantId: TENANT_A,
  roles: ["otec_admin"],
};

let svc: SupabaseClient;
let apiUrl: string;
let anonKey: string;
let jwtSecret: string;

beforeAll(() => {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string) => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  apiUrl = get("API_URL");
  anonKey = get("ANON_KEY");
  jwtSecret = get("JWT_SECRET");
  // tenantGuard()/writeAudit leen el entorno del servidor.
  process.env.NEXT_PUBLIC_SUPABASE_URL = apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = get("SERVICE_ROLE_KEY");
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;
  svc = createClient(apiUrl, get("SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
});

/** Cliente con el JWT de un principal (lo que en la app dan las cookies). */
async function sessionRpc(claims: { sub: string; tenant_id?: string; roles: string[] }) {
  const token = await new SignJWT({
    role: "authenticated",
    ...(claims.tenant_id ? { tenant_id: claims.tenant_id } : {}),
    roles: claims.roles,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(jwtSecret));
  const db = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return async (fn: string) => {
    const { data, error } = await db.rpc(fn);
    return { data, error: error ? { message: error.message } : null };
  };
}

describe("getPlatformOverview (HU-10.3)", () => {
  it("un otec_admin NO obtiene el tablero (null)", async () => {
    const overview = await getPlatformOverview(otecAdmin);
    expect(overview).toBeNull();
  });

  it("el superadmin obtiene totales coherentes con las filas por tenant", async () => {
    const rpc = await sessionRpc({ sub: SUPERADMIN_ID, roles: ["superadmin"] });
    const overview = await getPlatformOverview(superadmin, { rpc });
    expect(overview).not.toBeNull();

    const { summary, tenants } = overview!;
    // El seed trae 2 OTECs; otras suites crean más — se afirma coherencia, no
    // números fijos (la BD acumula entre corridas).
    expect(tenants.length).toBeGreaterThanOrEqual(2);
    expect(summary.totalTenants).toBe(tenants.length);
    expect(summary.active + summary.suspended).toBe(summary.totalTenants);
    expect(summary.totalStudents).toBe(tenants.reduce((n, t) => n + t.students, 0));
    expect(summary.totalEnrollments).toBe(tenants.reduce((n, t) => n + t.enrollments, 0));
    expect(summary.openAlerts).toBe(tenants.reduce((n, t) => n + t.openAlerts, 0));
  });

  it("los agregados llegan como NÚMEROS (el bigint de PostgREST viaja como string)", async () => {
    const rpc = await sessionRpc({ sub: SUPERADMIN_ID, roles: ["superadmin"] });
    const overview = await getPlatformOverview(superadmin, { rpc });
    const a = overview!.tenants.find((t) => t.tenantId === TENANT_A);
    expect(a).toBeDefined();
    expect(typeof a!.students).toBe("number");
    expect(typeof a!.enrollments).toBe("number");
    expect(Number.isNaN(a!.enrollments)).toBe(false);
    expect(a!.enrollments).toBeGreaterThanOrEqual(1);
  });

  it("el tablero incluye la salud del sistema", async () => {
    const rpc = await sessionRpc({ sub: SUPERADMIN_ID, roles: ["superadmin"] });
    const overview = await getPlatformOverview(superadmin, { rpc });
    // La BD local está viva: la sonda debe decirlo (si dijera "fail" con la BD
    // arriba, la sonda estaría rota — que es justo el bug que corrigió esta task).
    expect(overview!.health.checks.db).toBe("ok");
    expect(overview!.health.status).toBe("ok");
    expect(typeof overview!.health.version).toBe("string");
  });

  it("si la RPC rechaza (JWT sin el claim), degrada a tablero vacío en vez de romper", async () => {
    // El gate de app pasa (principal miente), pero la BD manda: 42501.
    const rpc = await sessionRpc({ sub: SUPERADMIN_ID, tenant_id: TENANT_A, roles: ["otec_admin"] });
    const overview = await getPlatformOverview(superadmin, { rpc });
    expect(overview!.tenants).toEqual([]);
    expect(overview!.summary.totalTenants).toBe(0);
  });
});

describe("recordTenantSupportView: soporte auditado (spec §3)", () => {
  it("escribe platform.tenant_viewed en el audit_log DEL TENANT mirado", async () => {
    const ok = await recordTenantSupportView(superadmin, TENANT_A);
    expect(ok).toBe(true);

    const { data, error } = await svc
      .from("audit_log")
      .select("tenant_id, actor_user_id, action, entity, entity_id")
      .eq("tenant_id", TENANT_A)
      .eq("action", "platform.tenant_viewed")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({
      tenant_id: TENANT_A,
      actor_user_id: SUPERADMIN_ID,
      action: "platform.tenant_viewed",
      entity: "tenants",
      entity_id: TENANT_A,
    });
  });

  it("un otec_admin no puede registrar accesos de soporte (no es superadmin)", async () => {
    const ok = await recordTenantSupportView(otecAdmin, TENANT_A);
    expect(ok).toBe(false);
  });

  it("un tenantId que no es UUID deniega limpio (no revienta)", async () => {
    const ok = await recordTenantSupportView(superadmin, "no-soy-un-uuid");
    expect(ok).toBe(false);
  });
});
