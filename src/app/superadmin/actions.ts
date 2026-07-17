"use server";

import { getPrincipal } from "@/modules/core/auth/session";
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
 */
export async function viewTenantDetailAction(
  _prev: TenantDetailState,
  formData: FormData,
): Promise<TenantDetailState> {
  const principal = await getPrincipal();
  if (!principal) return { error: "forbidden" };

  const tenantId = String(formData.get("tenantId") ?? "");
  const audited = await recordTenantSupportView(principal, tenantId);
  if (!audited) return { error: "audit_failed" };

  const overview = await getPlatformOverview(principal);
  const detail = overview?.tenants.find((t) => t.tenantId === tenantId);
  if (!detail) return { error: "forbidden" };
  return { detail };
}
