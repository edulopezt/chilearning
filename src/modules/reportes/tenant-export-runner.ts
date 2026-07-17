// ⚠ SIN `import "server-only"`: lo ejecuta el proceso worker (job
// `tenant-export-tick`), fuera de Next. Imports RELATIVOS (el bundle de esbuild
// no resuelve el alias `@/`) y NADA que arrastre `server-only` (tenant-guard,
// audit y `reportes/zip.ts` lo tienen — por eso este archivo usa `zip-core.ts`).
// Mismo patrón que `comunicacion/reminders.ts` y `certificados/expiry-alerts.ts`.
import type { SupabaseClient } from "@supabase/supabase-js";

import { renderExportFailedEmail, renderExportReadyEmail } from "../comunicacion/domain/email-templates";
import type { EmailSender } from "../comunicacion/email-sender";
import {
  buildManifest,
  datasetToCsv,
  datasetToJson,
  DEFAULT_MAX_EXPORT_BYTES,
  EXPORT_DATASETS,
  FileBudget,
  type ExportDatasetEntry,
} from "./domain/tenant-export";
import { safeFileSlug } from "./domain/expediente";
import { buildZip } from "./zip-core";

/**
 * Worker del export completo del tenant (task 5.13, HU-1.5). Reclama la
 * solicitud `pending` más antigua (claim optimista de dos pasos, tolera
 * concurrencia), arma el ZIP (datasets + archivos de Storage bajo presupuesto
 * + manifiesto) y deja la fila en `done`/`failed`, notifica y audita.
 *
 * ⚠ DISCIPLINA DE TENANT (foco #1 de la revisión de 4 ojos de este PR): aquí
 * NO hay `tenantGuard` (el worker corre con service-role, que bypassa RLS por
 * completo). Cada `fetchDataset` filtra por `.eq(tenantColumn, tenantId)` a
 * mano — sin ese filtro, un dataset cruzaría TODOS los tenants de la
 * plataforma. `tenants` es la única excepción declarada (filtra por `id`).
 */

const BUCKET_EXPORTS = "exports";
const PAGE = 1000;
const MAX_ERROR_LEN = 500;

interface StorageFileSpec {
  readonly datasetName: string;
  readonly bucket: string;
  readonly pathColumn: string;
  readonly destPrefix: string;
}

// Los 3 datasets que llevan un archivo binario aparte del CSV/JSON (metadatos
// SOLO en el dataset; el archivo real va bajo `archivos/<bucket>/...`).
const STORAGE_FILES: readonly StorageFileSpec[] = [
  { datasetName: "certificates", bucket: "certificates", pathColumn: "pdf_path", destPrefix: "archivos/certificates" },
  { datasetName: "action_documents", bucket: "action_documents", pathColumn: "file_path", destPrefix: "archivos/action_documents" },
  { datasetName: "submissions", bucket: "submissions", pathColumn: "file_path", destPrefix: "archivos/submissions" },
];

export interface TenantExportRunnerDeps {
  readonly emailSender: EmailSender;
  /** Resuelve correo+nombre por user_id (producción: admin API; tests: stub). */
  readonly resolveRecipients: (userIds: readonly string[]) => Promise<Map<string, { email: string; name: string }>>;
  /** Base URL absoluta para el enlace del correo (el worker no tiene origin). */
  readonly appBaseUrl?: string;
  /** Override del presupuesto de tamaño (tests); default 300 MB. */
  readonly maxBytes?: number;
}

export interface TenantExportTickSummary {
  readonly claimed: boolean;
  readonly exportId?: string;
  readonly status?: "done" | "failed";
  readonly totalBytes?: number;
  readonly notified?: boolean;
}

interface ClaimedExport {
  readonly id: string;
  readonly tenantId: string;
  readonly requestedBy: string;
}

/**
 * Claim optimista de DOS pasos: lee el `pending` más antiguo y lo pasa a
 * `running` con un `update … where status = 'pending'` (verificado por
 * `.select().maybeSingle()`, no por conteo de filas — supabase-js no expone
 * `rowCount` en `update`). Si otra corrida ya lo tomó, el `update` no afecta
 * ninguna fila y `data` vuelve vacío: se trata como "nada que reclamar".
 */
async function claimNextExport(db: SupabaseClient): Promise<ClaimedExport | null> {
  const { data: candidate } = await db
    .from("tenant_exports")
    .select("id")
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!candidate) return null;

  const { data: claimed, error } = await db
    .from("tenant_exports")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", candidate.id as string)
    .eq("status", "pending")
    .select("id, tenant_id, requested_by")
    .maybeSingle();
  if (error || !claimed) return null; // otra corrida ganó la carrera

  return { id: claimed.id as string, tenantId: claimed.tenant_id as string, requestedBy: claimed.requested_by as string };
}

async function fetchDataset(
  db: SupabaseClient,
  entry: ExportDatasetEntry,
  tenantId: string,
): Promise<Record<string, unknown>[]> {
  const tenantColumn = entry.tenantColumn ?? "tenant_id";
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const base = db.from(entry.table).select(entry.columns.join(",")).eq(tenantColumn, tenantId);
    const ordered = entry.orderBy.reduce((q, o) => q.order(o.column, { ascending: o.ascending ?? true }), base);
    const { data } = await ordered.range(offset, offset + PAGE - 1);
    // `entry.columns.join(",")` es un string DINÁMICO (no un literal): el parseo
    // de tipos de supabase-js para `.select()` no puede inferir la forma de la
    // fila a partir de eso y cae a un tipo de error a nivel de tipos (no en
    // runtime). El registro está verificado a mano contra el esquema real (ver
    // `domain/tenant-export.ts`), así que el cast es seguro.
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function loadBrand(db: SupabaseClient, tenantId: string): Promise<{ orgName: string; primaryColor: string }> {
  const { data } = await db.from("tenants").select("name, branding, slug").eq("id", tenantId).maybeSingle();
  const branding = (data?.branding ?? {}) as { primaryColor?: string };
  return { orgName: (data?.name as string) ?? "Chilearning", primaryColor: branding.primaryColor ?? "#1e3a8a" };
}

async function tenantSlug(db: SupabaseClient, tenantId: string): Promise<string> {
  const { data } = await db.from("tenants").select("slug").eq("id", tenantId).maybeSingle();
  return (data?.slug as string) ?? tenantId;
}

/** Descarga un archivo de Storage y lo admite en el ZIP bajo presupuesto (o lo registra como omitido — nunca en silencio). */
async function addStorageFile(
  db: SupabaseClient,
  spec: StorageFileSpec,
  path: string,
  rowId: string,
  budget: FileBudget,
  files: { name: string; bytes: Uint8Array }[],
): Promise<void> {
  const destName = `${spec.destPrefix}/${rowId}-${safeFileSlug(path.split("/").pop() ?? path)}`;
  const dl = await db.storage.from(spec.bucket).download(path);
  if (dl.error || !dl.data) {
    budget.recordOmitted(destName, "archivo no encontrado en storage");
    return;
  }
  const bytes = new Uint8Array(await dl.data.arrayBuffer());
  if (budget.tryAdd(destName, bytes.byteLength)) {
    files.push({ name: destName, bytes });
  }
}

async function markFailed(db: SupabaseClient, exportId: string, err: unknown): Promise<string> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_LEN);
  await db
    .from("tenant_exports")
    .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
    .eq("id", exportId);
  return message;
}

async function notifyAndAudit(
  db: SupabaseClient,
  deps: TenantExportRunnerDeps,
  params: { exportId: string; tenantId: string; requestedBy: string; status: "done" | "failed"; error?: string },
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const kind = params.status === "done" ? "export.ready" : "export.failed";
  const { error: notifyError } = await db.from("notifications").insert({
    tenant_id: params.tenantId,
    user_id: params.requestedBy,
    kind,
    payload: { exportId: params.exportId },
    created_at: nowIso,
  });
  let notified = !notifyError;
  if (notifyError) {
    console.error("[tenant-export] aviso in-app falló", { exportId: params.exportId, code: notifyError.code });
  }

  await db.from("audit_log").insert({
    tenant_id: params.tenantId,
    actor_user_id: null, // acción de sistema (worker), sin actor humano
    action: params.status === "done" ? "tenant.export_completed" : "tenant.export_failed",
    entity: "tenant_exports",
    entity_id: params.exportId,
    details: params.status === "done" ? {} : { error: params.error ?? "" },
  });

  // Correo best-effort al solicitante real (única salida con PII); enlaza a la
  // PÁGINA del export, jamás al archivo (el signed URL se firma recién al pedirla).
  const recipients = await deps.resolveRecipients([params.requestedBy]);
  const r = recipients.get(params.requestedBy);
  if (r?.email && deps.emailSender.configured) {
    const brand = await loadBrand(db, params.tenantId);
    const base = (deps.appBaseUrl ?? "").replace(/\/$/, "");
    const exportPageUrl = `${base}/admin/exportacion`;
    const email =
      params.status === "done"
        ? renderExportReadyEmail({ brand, recipientName: r.name, exportPageUrl })
        : renderExportFailedEmail({ brand, recipientName: r.name, exportPageUrl });
    const sent = await deps.emailSender.send({ to: r.email, subject: email.subject, html: email.html, text: email.text });
    notified = notified && sent.ok;
  }
  return notified;
}

export async function runTenantExportTick(db: SupabaseClient, deps: TenantExportRunnerDeps): Promise<TenantExportTickSummary> {
  const claim = await claimNextExport(db);
  if (!claim) return { claimed: false };
  const { id: exportId, tenantId, requestedBy } = claim;

  try {
    const budget = new FileBudget(deps.maxBytes ?? DEFAULT_MAX_EXPORT_BYTES);
    const files: { name: string; bytes: Uint8Array }[] = [];
    const counts: Record<string, number> = {};
    const rowsByDataset = new Map<string, Record<string, unknown>[]>();

    for (const entry of EXPORT_DATASETS) {
      const rows = await fetchDataset(db, entry, tenantId);
      rowsByDataset.set(entry.name, rows);
      counts[entry.name] = rows.length;
      if (rows.length === 0) continue;

      const csvBytes = new TextEncoder().encode(datasetToCsv(entry.columns, rows));
      if (budget.tryAdd(`datasets/${entry.name}.csv`, csvBytes.byteLength)) {
        files.push({ name: `datasets/${entry.name}.csv`, bytes: csvBytes });
      }
      const jsonBytes = new TextEncoder().encode(datasetToJson(rows));
      if (budget.tryAdd(`datasets/${entry.name}.json`, jsonBytes.byteLength)) {
        files.push({ name: `datasets/${entry.name}.json`, bytes: jsonBytes });
      }
    }

    // Archivos de Storage (certificados, documentos de expediente, entregas):
    // se leen del path ya fetcheado arriba — sin una segunda consulta.
    for (const spec of STORAGE_FILES) {
      const rows = rowsByDataset.get(spec.datasetName) ?? [];
      for (const row of rows) {
        const path = row[spec.pathColumn] as string | null;
        if (!path) continue; // ej. certificates.pdf_path puede ser NULL
        await addStorageFile(db, spec, path, row.id as string, budget, files);
      }
    }

    const manifest = buildManifest({
      tenantSlug: await tenantSlug(db, tenantId),
      generatedAt: new Date().toISOString(),
      datasets: counts,
      files: { included: files.map((f) => ({ name: f.name, bytes: f.bytes.byteLength })), omitted: budget.omitted },
    });
    files.push({ name: "manifest.json", bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });

    const zipBuffer = await buildZip(files);
    const filePath = `${tenantId}/${exportId}.zip`;
    const up = await db.storage.from(BUCKET_EXPORTS).upload(filePath, zipBuffer, { contentType: "application/zip", upsert: true });
    if (up.error) throw new Error(`upload falló: ${up.error.message}`);

    const finishedIso = new Date().toISOString();
    await db
      .from("tenant_exports")
      .update({ status: "done", file_path: filePath, file_size: zipBuffer.byteLength, counts, finished_at: finishedIso })
      .eq("id", exportId);

    const notified = await notifyAndAudit(db, deps, { exportId, tenantId, requestedBy, status: "done" });
    return { claimed: true, exportId, status: "done", totalBytes: zipBuffer.byteLength, notified };
  } catch (err) {
    const message = await markFailed(db, exportId, err);
    const notified = await notifyAndAudit(db, deps, { exportId, tenantId, requestedBy, status: "failed", error: message });
    return { claimed: true, exportId, status: "failed", notified };
  }
}
