import "server-only";

import type { TenantGuard } from "@/lib/tenant-guard";

/**
 * Escritura estándar en `audit_log` (P8) desde los servicios. Extrae el patrón
 * de `branding-service` para que toda acción sensible audite igual. NUNCA
 * silencioso: si el insert falla se loguea y se reporta al llamador (quien
 * decide si el fallo es fatal — p.ej. un cambio de nota SIN auditoría debe
 * abortar, revisión R-3 del PR #33).
 */
export interface AuditEntry {
  /** UUID del actor; null = acción de sistema (worker). */
  readonly actorUserId: string | null;
  /** Convención verbo-punto: `grade.updated`, `course.cloned`, … */
  readonly action: string;
  readonly entity: string;
  readonly entityId: string;
  readonly details?: Record<string, unknown>;
}

export async function writeAudit(guard: TenantGuard, entry: AuditEntry): Promise<boolean> {
  const { error } = await guard.db.from("audit_log").insert(
    guard.withTenant({
      actor_user_id: entry.actorUserId,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId,
      details: entry.details ?? {},
    }),
  );
  if (error) {
    console.error("[audit] fallo escribiendo audit_log", {
      action: entry.action,
      message: error.message,
    });
    return false;
  }
  return true;
}
