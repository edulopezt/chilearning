import "server-only";

import type { TenantGuard } from "@/lib/tenant-guard";
import { isFeatureEnabled, type FeatureKey } from "@/modules/core/domain/features";

/**
 * Gate de features por tenant (task 5.3, HU-1.3).
 *
 * CONTRATO para los consumidores (PRs 5.1 SCORM / 5.8 tutor IA / 5.11 WhatsApp):
 *  - Un endpoint (route handler / server action) cuya feature está apagada
 *    responde `NextResponse.json({ error: "feature_disabled" }, { status: 403 })`
 *    (o el resultado discriminado equivalente en un server action).
 *  - Las páginas OCULTAN la entrada de UI: la función DESAPARECE, no se muestra
 *    deshabilitada a medias.
 *  - Deny-by-default (P7): flags ausentes, null o malformados = feature apagada.
 */

/** Lee el jsonb crudo de flags del tenant (null si el tenant no existe). */
export async function getTenantFlags(guard: TenantGuard, tenantId: string): Promise<unknown> {
  // Un cruce guard/tenant es un bug del llamador: revienta, no degrada.
  guard.assertTenant(tenantId);
  const { data } = await guard.db.from("tenants").select("flags").eq("id", tenantId).maybeSingle();
  return data?.flags ?? null;
}

/** ¿Tiene el tenant la feature encendida? (para gatear endpoints y UI). */
export async function requireFeature(
  guard: TenantGuard,
  tenantId: string,
  key: FeatureKey,
): Promise<boolean> {
  return isFeatureEnabled(await getTenantFlags(guard, tenantId), key);
}
