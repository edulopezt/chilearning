import "server-only";

import { writeAudit } from "@/lib/audit";
import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { DEFAULT_EXPIRY_OFFSETS, parseOffsetsInput, sanitizeOffsets } from "@/modules/certificados/domain/expiry";

/**
 * Configuración de alertas de recertificación (task 5.12, HU-7.3): cuántos días
 * antes avisar y si el aviso está activo. La CA pide "alertas configurables
 * (90/60/30 días)" — 90/60/30 es el DEFAULT, no un hardcode.
 *
 * Sin fila en `certificate_expiry_config` el tenant opera con los defaults
 * HABILITADOS: la vigencia sirve de poco si hay que acordarse de encender los
 * avisos. Por eso `getExpiryConfig` nunca devuelve null y el worker trata
 * "sin fila" igual que "enabled con 90/60/30".
 */

const MANAGERS = ["otec_admin", "coordinator"] as const;

export interface ExpiryConfig {
  readonly offsetsDays: readonly number[];
  readonly enabled: boolean;
  /** true = aún no hay fila; el tenant corre con los defaults de la CA. */
  readonly isDefault: boolean;
}

export type ExpiryConfigResult =
  | { readonly ok: true; readonly config: ExpiryConfig }
  | { readonly ok: false; readonly error: "forbidden" | "failed" | "invalid_offsets" };

export const DEFAULT_EXPIRY_CONFIG: ExpiryConfig = {
  offsetsDays: DEFAULT_EXPIRY_OFFSETS,
  enabled: true,
  isDefault: true,
};

function canManage(p: Principal): boolean {
  return Boolean(p.tenantId) && authorize(p, p.tenantId!, MANAGERS);
}

/** Config del tenant, o los defaults si aún no la tocaron. Nunca null. */
export async function getExpiryConfig(principal: Principal): Promise<ExpiryConfig | null> {
  if (!canManage(principal)) return null;
  const guard = tenantGuard(principal.tenantId!);
  const { data } = await guard.db
    .from("certificate_expiry_config")
    .select("offsets_days, enabled")
    .eq("tenant_id", principal.tenantId!)
    .maybeSingle();
  if (!data) return DEFAULT_EXPIRY_CONFIG;
  return {
    // `sanitizeOffsets` también en la LECTURA: la columna es `int[]` y el CHECK
    // acota el rango, pero el orden descendente que `dueOffset` asume es del
    // dominio, no de la BD.
    offsetsDays: sanitizeOffsets(data.offsets_days),
    enabled: Boolean(data.enabled),
    isDefault: false,
  };
}

/** Upsert de la config + auditoría. Los offsets se normalizan en el dominio. */
export async function updateExpiryConfig(
  principal: Principal,
  raw: { offsetsDays?: unknown; enabled?: unknown },
): Promise<ExpiryConfigResult> {
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const tenantId = principal.tenantId!;
  const guard = tenantGuard(tenantId);

  // ESCRITURA: se VALIDA, no se coerciona. Guardar en silencio 90/60/30 cuando el
  // coordinador tecleó otra cosa (o un token inválido) le hace creer que configuró
  // un aviso que nunca se manda (4-ojos MED). El fail-open de `sanitizeOffsets`
  // queda SOLO para la lectura (getExpiryConfig) y el worker.
  const parsed = parseOffsetsInput(raw.offsetsDays);
  if (!parsed.ok) return { ok: false, error: "invalid_offsets" };
  const offsetsDays = parsed.value;
  const enabled = raw.enabled === true || raw.enabled === "true" || raw.enabled === "on";

  const { error } = await guard.db
    .from("certificate_expiry_config")
    .upsert(
      guard.withTenant({
        offsets_days: offsetsDays,
        enabled,
        updated_by: principal.userId,
        updated_at: new Date().toISOString(),
      }),
      { onConflict: "tenant_id" },
    );
  if (error) {
    console.error("[cert-expiry] no se pudo guardar la config", { message: error.message });
    return { ok: false, error: "failed" };
  }

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "certificates.expiry_config_updated",
    entity: "certificate_expiry_config",
    entityId: tenantId,
    details: { offsetsDays, enabled },
  });
  return { ok: true, config: { offsetsDays, enabled, isDefault: false } };
}
