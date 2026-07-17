"use server";

import { getPrincipal } from "@/modules/core/auth/session";
import { isSuperadmin } from "@/modules/core/domain/rbac";
import type { TenantStatsRow } from "@/modules/plataforma/domain/overview";
import { getPlatformOverview, recordTenantSupportView } from "@/modules/plataforma/platform-service";

/** Server Actions del tablero de plataforma (task 5.5, HU-10.3). */

export interface TenantDetailState {
  readonly detail?: TenantStatsRow;
  readonly error?: "forbidden" | "audit_failed";
}

/**
 * Soporte auditado (spec §3): registra el acceso ANTES de devolver el detalle.
 * El detalle viaja como RESULTADO de la action (no como `?detalle=<id>`): así no
 * existe una URL que pinte el detalle sin dejar traza al refrescar. Si la
 * auditoría falla, no hay detalle — acceso sensible sin registro = acceso que no
 * ocurre (P8).
 *
 * La action se gatea SOLA: `superadmin/layout.tsx` no la cubre, porque una Server
 * Action es un endpoint POST propio, alcanzable por cualquiera que tenga su id
 * sin pasar por la página que la renderizó. El gate explícito no es redundante:
 * es la única defensa de esta ruta a nivel de app (abajo siguen el gate de
 * `recordTenantSupportView`, el de `getPlatformOverview`, el 42501 de la RPC y
 * RLS).
 */
export async function viewTenantDetailAction(
  _prev: TenantDetailState,
  formData: FormData,
): Promise<TenantDetailState> {
  const principal = await getPrincipal();
  if (!principal) return { error: "forbidden" };
  // Sin esto, un no-superadmin caía en el deny interno de
  // `recordTenantSupportView` y se llevaba un "audit_failed" — se le reportaba
  // una falla transitoria de la auditoría, con invitación a reintentar, en vez de
  // una denegación de permiso. Además volvía indistinguibles una caída real del
  // `audit_log` y un intento no autorizado, que es justo el que uno querría ver.
  if (!isSuperadmin(principal)) return { error: "forbidden" };

  const tenantId = String(formData.get("tenantId") ?? "");
  const audited = await recordTenantSupportView(principal, tenantId);
  if (!audited) return { error: "audit_failed" };

  const overview = await getPlatformOverview(principal);
  const detail = overview?.tenants.find((t) => t.tenantId === tenantId);
  if (!detail) return { error: "forbidden" };
  return { detail };
}
