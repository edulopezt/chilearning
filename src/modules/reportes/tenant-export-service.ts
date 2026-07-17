import "server-only";

import { writeAudit } from "@/lib/audit";
import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";

/**
 * Export completo del tenant (task 5.13, HU-1.5): puerta de entrada
 * request/list/download. La ejecución en sí (armar el ZIP) la hace el worker
 * (`tenant-export-runner.ts`); este servicio solo encola, lista y firma la
 * descarga — SIEMPRE gated a `otec_admin` (ni coordinator: el export trae RUN,
 * notas, certificados y documentos de TODA la OTEC — RLS de `tenant_exports`
 * ya lo exige a nivel de tabla; este `authorize()` es la MISMA regla en el
 * servicio, no una segunda puerta distinta).
 */

const STAFF = ["otec_admin"] as const;
const BUCKET = "exports";

export type RequestExportResult =
  | { ok: true; id: string }
  | { ok: false; error: "forbidden" | "already_running" | "failed" };

/** Encola un export. El índice único parcial (`pending`/`running`) es la fuente
 *  de verdad de "uno a la vez"; el 23505 se traduce a `already_running`. */
export async function requestExport(principal: Principal): Promise<RequestExportResult> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, STAFF)) {
    return { ok: false, error: "forbidden" };
  }
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data, error } = await guard.db
    .from("tenant_exports")
    .insert(guard.withTenant({ requested_by: principal.userId }))
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") return { ok: false, error: "already_running" };
    return { ok: false, error: "failed" };
  }
  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "tenant.export_requested",
    entity: "tenant_exports",
    entityId: data.id as string,
  });
  return { ok: true, id: data.id as string };
}

export interface TenantExportRow {
  readonly id: string;
  readonly status: string;
  readonly fileSize: number | null;
  readonly counts: Record<string, number>;
  readonly error: string | null;
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

/** Solicitudes del tenant, más recientes primero. [] si no autorizado (no null: la UI lista sin caso especial). */
export async function listExports(principal: Principal): Promise<TenantExportRow[]> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, STAFF)) return [];
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data } = await guard.db
    .from("tenant_exports")
    .select("id, status, file_size, counts, error, requested_at, started_at, finished_at")
    .eq("tenant_id", tenantId)
    .order("requested_at", { ascending: false });
  return (data ?? []).map((r) => ({
    id: r.id as string,
    status: r.status as string,
    fileSize: (r.file_size as number | null) ?? null,
    counts: (r.counts ?? {}) as Record<string, number>,
    error: (r.error as string | null) ?? null,
    requestedAt: r.requested_at as string,
    startedAt: (r.started_at as string | null) ?? null,
    finishedAt: (r.finished_at as string | null) ?? null,
  }));
}

/**
 * Signed URL de 1 h para el ZIP de un export `done`. Verifica tenant + estado
 * ANTES de firmar (nunca firma sobre un export ajeno o todavía no listo), y
 * audita la descarga.
 */
export async function getExportDownloadUrl(principal: Principal, exportId: string): Promise<string | null> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, STAFF)) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data: exp } = await guard.db
    .from("tenant_exports")
    .select("file_path, status")
    .eq("tenant_id", tenantId)
    .eq("id", exportId)
    .maybeSingle();
  if (!exp || exp.status !== "done" || !exp.file_path) return null;

  const signed = await guard.db.storage.from(BUCKET).createSignedUrl(exp.file_path as string, 3600);
  if (!signed.data) return null;
  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "tenant.export_downloaded",
    entity: "tenant_exports",
    entityId: exportId,
  });
  return signed.data.signedUrl;
}
