import "server-only";

import { writeAudit } from "@/lib/audit";
import { probeDb } from "@/lib/observability/db-probe";
import { buildHealthPayload, type HealthPayload } from "@/lib/observability/health";
import { tenantGuard } from "@/lib/tenant-guard";
import { isSuperadmin, type Principal } from "@/modules/core/domain/rbac";
import {
  sortForBoard,
  summarize,
  type PlatformSummary,
  type TenantStatsRow,
  type TenantStatus,
} from "@/modules/plataforma/domain/overview";

/**
 * Tablero superadmin (task 5.5, HU-10.3): tenants activos, uso, errores SENCE
 * agregados y salud del sistema.
 *
 * Restricción de rol (spec §3): el superadmin NO ve contenido pedagógico ni
 * datos de alumnos. Aquí SOLO viajan agregados — lo garantiza la forma del
 * retorno de la RPC `platform_tenant_stats`, no la buena voluntad del llamador.
 * El único acceso "de soporte" es `recordTenantSupportView`, y queda auditado.
 */

export interface PlatformOverview {
  readonly summary: PlatformSummary;
  readonly tenants: readonly TenantStatsRow[];
  readonly health: HealthPayload;
}

/** Fila cruda de la RPC (snake_case de Postgres). */
interface RawStatsRow {
  tenant_id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  created_at: string;
  students: number | string;
  enrollments: number | string;
  actions: number | string;
  courses: number | string;
  certificates: number | string;
  open_alerts: number | string;
  sence_error_alerts_7d: number | string;
  last_enrollment_at: string | null;
}

/**
 * `bigint` de Postgres llega como string por PostgREST (no cabe en un number de
 * JS de forma segura). Los conteos de este tablero jamás se acercan a 2^53, así
 * que el Number() es seguro; un valor no numérico degrada a 0 en vez de NaN.
 */
function toCount(value: number | string): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapRow(raw: RawStatsRow): TenantStatsRow {
  return {
    tenantId: raw.tenant_id,
    slug: raw.slug,
    name: raw.name,
    plan: raw.plan,
    status: raw.status === "suspended" ? "suspended" : ("active" satisfies TenantStatus),
    createdAt: raw.created_at,
    students: toCount(raw.students),
    enrollments: toCount(raw.enrollments),
    actions: toCount(raw.actions),
    courses: toCount(raw.courses),
    certificates: toCount(raw.certificates),
    openAlerts: toCount(raw.open_alerts),
    senceErrorAlerts7d: toCount(raw.sence_error_alerts_7d),
    lastEnrollmentAt: raw.last_enrollment_at,
  };
}

/**
 * Dependencia inyectable del cliente de sesión. Por defecto usa el cliente del
 * USUARIO (cookies), NUNCA el service-role: así el gate 42501 de la RPC se
 * ejerce con el JWT real y RLS sigue siendo la última línea de defensa.
 */
export interface PlatformDeps {
  readonly rpc?: (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>;
}

async function defaultRpc(fn: string): Promise<{ data: unknown; error: { message: string } | null }> {
  // Import diferido: `next/headers` solo existe en request scope; los tests de
  // integración inyectan su propio cliente y no deben arrastrar ese módulo.
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await createSupabaseServerClient();
  return supabase.rpc(fn);
}

/**
 * Métricas + salud para el tablero. Devuelve null si el principal no es
 * superadmin (la RPC lo rechazaría igual con 42501: gate en app Y en BD).
 */
export async function getPlatformOverview(
  principal: Principal,
  deps: PlatformDeps = {},
): Promise<PlatformOverview | null> {
  if (!isSuperadmin(principal)) return null;

  const rpc = deps.rpc ?? defaultRpc;
  const { data, error } = await rpc("platform_tenant_stats");

  // La salud se mide SIEMPRE, incluso si las métricas fallan: si la BD está
  // caída, el tablero debe poder decirlo en vez de romperse entero.
  const health = buildHealthPayload({ db: await probeDb() }, versionLabel(), new Date().toISOString());

  if (error || !Array.isArray(data)) {
    if (error) {
      console.error("[platform-service] platform_tenant_stats falló", { message: error.message });
    }
    return { summary: summarize([]), tenants: [], health };
  }

  const rows = (data as RawStatsRow[]).map(mapRow);
  return { summary: summarize(rows), tenants: sortForBoard(rows), health };
}

function versionLabel(): string {
  return process.env.SENTRY_RELEASE ?? process.env.APP_VERSION ?? "dev";
}

/**
 * Soporte AUDITADO (spec §3): el superadmin puede mirar el detalle de una OTEC,
 * pero queda registrado. La traza se escribe en el `audit_log` DEL TENANT
 * mirado, no en uno de plataforma: así el otec_admin VE en su propia auditoría
 * que soporte entró — transparencia hacia el cliente, no solo hacia nosotros.
 * Devuelve false si no se pudo auditar: el llamador NO debe mostrar el detalle
 * sin traza (acceso sensible sin registro = acceso que no ocurre).
 */
export async function recordTenantSupportView(
  principal: Principal,
  tenantId: string,
): Promise<boolean> {
  if (!isSuperadmin(principal)) return false;

  let guard;
  try {
    guard = tenantGuard(tenantId);
  } catch {
    // tenantId no es UUID (viene de FormData): deny limpio, sin reventar.
    return false;
  }

  return writeAudit(guard, {
    actorUserId: principal.userId,
    action: "platform.tenant_viewed",
    entity: "tenants",
    entityId: tenantId,
  });
}
