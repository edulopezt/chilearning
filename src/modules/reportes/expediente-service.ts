import "server-only";

import { randomUUID } from "node:crypto";

import { writeAudit } from "@/lib/audit";
import { tenantGuard, type TenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { toCsv } from "@/modules/reportes/domain/cumplimiento";
import {
  completeness,
  expedienteChecklist,
  manifestRows,
  parseDocumentInput,
  safeFileSlug,
  validateExpedienteFile,
  type ChecklistRow,
  type DocType,
  type FieldError,
} from "@/modules/reportes/domain/expediente";
import { buildZip } from "@/modules/reportes/zip";

/**
 * Expediente de fiscalización por acción (task 3.12, HU-5.10). Staff-only (trae
 * OC OTIC con montos → sin supervisor). Documentos con tipo/estado/fecha,
 * checklist de completitud, definitivos INMUTABLES y descarga ZIP en un clic.
 */

const STAFF = ["otec_admin", "coordinator", "instructor"] as const;
const BUCKET = "action_documents";
const PAGE = 1000;

async function fetchAll<T>(page: (o: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let o = 0; ; o += PAGE) {
    const { data } = await page(o);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

interface DocRow {
  id: string;
  doc_type: DocType;
  title: string;
  status: string;
  is_definitive: boolean;
  document_date: string | null;
  file_path: string;
  file_name: string;
}

async function loadDocs(guard: TenantGuard, tenantId: string, actionId: string): Promise<DocRow[]> {
  return fetchAll<DocRow>((o) =>
    guard.db.from("action_documents").select("id, doc_type, title, status, is_definitive, document_date, file_path, file_name").eq("tenant_id", tenantId).eq("action_id", actionId).order("created_at", { ascending: true }).range(o, o + PAGE - 1),
  );
}

async function actionLine(guard: TenantGuard, tenantId: string, actionId: string): Promise<number | null> {
  const { data } = await guard.db.from("actions").select("training_line").eq("tenant_id", tenantId).eq("id", actionId).maybeSingle();
  return data ? (data.training_line as number) : null;
}

export interface ExpedienteView {
  readonly actionId: string;
  readonly documents: readonly { id: string; docType: DocType; title: string; status: string; isDefinitive: boolean; documentDate: string | null; fileName: string }[];
  readonly checklist: readonly ChecklistRow[];
  readonly completeness: { done: number; total: number; complete: boolean };
}

export async function getExpediente(principal: Principal, actionId: string): Promise<ExpedienteView | null> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, STAFF)) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const line = await actionLine(guard, tenantId, actionId);
  if (line === null) return null;
  const docs = await loadDocs(guard, tenantId, actionId);
  const forChecklist = docs.map((d) => ({ docType: d.doc_type, isDefinitive: d.is_definitive }));
  return {
    actionId,
    documents: docs.map((d) => ({ id: d.id, docType: d.doc_type, title: d.title, status: d.status, isDefinitive: d.is_definitive, documentDate: d.document_date, fileName: d.file_name })),
    checklist: expedienteChecklist(forChecklist, line),
    completeness: completeness(forChecklist, line),
  };
}

export type UploadResult = { ok: true; id: string } | { ok: false; error: "forbidden" | "invalid" | "file" | "failed"; errors?: FieldError[] };

export async function uploadDocument(
  principal: Principal,
  actionId: string,
  raw: { docType?: unknown; title?: unknown; documentDate?: unknown },
  file: { name: string; size: number; type: string; bytes: ArrayBuffer },
): Promise<UploadResult> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, STAFF)) return { ok: false, error: "forbidden" };
  const parsed = parseDocumentInput(raw);
  if (!parsed.ok) return { ok: false, error: "invalid", errors: parsed.errors };
  const fileCheck = validateExpedienteFile(file);
  if (!fileCheck.ok) return { ok: false, error: "file" };

  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const docId = randomUUID();
  const path = `${tenantId}/${actionId}/${docId}-${safeFileSlug(file.name)}`;

  const up = await guard.db.storage.from(BUCKET).upload(path, new Uint8Array(file.bytes), { contentType: file.type, upsert: false });
  if (up.error) return { ok: false, error: "failed" };

  const { data, error } = await guard.db.from("action_documents").insert(guard.withTenant({
    id: docId, action_id: actionId, doc_type: parsed.value.docType, title: parsed.value.title,
    document_date: parsed.value.documentDate, file_path: path, file_name: file.name, file_size: file.size, mime_type: file.type, uploaded_by: principal.userId,
  })).select("id").single();
  if (error || !data) {
    await guard.db.storage.from(BUCKET).remove([path]); // sin huérfanos
    return { ok: false, error: "failed" };
  }
  await writeAudit(guard, { actorUserId: principal.userId, action: "expediente.document_added", entity: "action_documents", entityId: docId, details: { docType: parsed.value.docType } });
  return { ok: true, id: docId };
}

export async function markDefinitive(principal: Principal, documentId: string): Promise<{ ok: boolean }> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, STAFF)) return { ok: false };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  // Solo la transición borrador→definitivo (el trigger bloquea tocar un definitivo).
  const { data, error } = await guard.db.from("action_documents").update({ is_definitive: true, status: "vigente" }).eq("tenant_id", tenantId).eq("id", documentId).eq("is_definitive", false).select("id").maybeSingle();
  if (error || !data) return { ok: false };
  await writeAudit(guard, { actorUserId: principal.userId, action: "expediente.document_finalized", entity: "action_documents", entityId: documentId });
  return { ok: true };
}

export async function getDocumentDownloadUrl(principal: Principal, documentId: string): Promise<string | null> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, STAFF)) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data: doc } = await guard.db.from("action_documents").select("file_path").eq("tenant_id", tenantId).eq("id", documentId).maybeSingle();
  if (!doc) return null;
  const signed = await guard.db.storage.from(BUCKET).createSignedUrl(doc.file_path as string, 3600);
  if (signed.data) {
    await writeAudit(guard, { actorUserId: principal.userId, action: "expediente.document_viewed", entity: "action_documents", entityId: documentId });
  }
  return signed.data?.signedUrl ?? null;
}

export interface ManifestLabels {
  readonly type: string;
  readonly title: string;
  readonly status: string;
  readonly definitive: string;
  readonly date: string;
  readonly file: string;
}

/** Arma el ZIP del expediente (documentos + MANIFIESTO.csv). Descarga en un clic. */
export async function buildExpedienteZip(principal: Principal, actionId: string, labels: ManifestLabels): Promise<{ filename: string; buffer: Buffer } | null> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, STAFF)) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const docs = await loadDocs(guard, tenantId, actionId);
  if (docs.length === 0) return null;

  const files: { name: string; bytes: Uint8Array }[] = [];
  const used = new Set<string>();
  for (const d of docs) {
    const dl = await guard.db.storage.from(BUCKET).download(d.file_path);
    if (dl.error || !dl.data) continue;
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    // Nombre único dentro del ZIP.
    let name = `${d.doc_type}/${safeFileSlug(d.file_name)}`;
    let i = 1;
    while (used.has(name)) { name = `${d.doc_type}/${i}-${safeFileSlug(d.file_name)}`; i += 1; }
    used.add(name);
    files.push({ name, bytes });
  }

  const manifest = toCsv(
    [labels.type, labels.title, labels.status, labels.definitive, labels.date, labels.file],
    manifestRows(docs.map((d) => ({ docType: d.doc_type, title: d.title, status: d.status, isDefinitive: d.is_definitive, documentDate: d.document_date, fileName: d.file_name }))),
  );
  files.push({ name: "MANIFIESTO.csv", bytes: new TextEncoder().encode(manifest) });

  const buffer = await buildZip(files);
  await writeAudit(guard, { actorUserId: principal.userId, action: "expediente.downloaded", entity: "actions", entityId: actionId, details: { count: docs.length } });

  const { data: action } = await guard.db.from("actions").select("codigo_accion").eq("tenant_id", tenantId).eq("id", actionId).maybeSingle();
  const code = ((action?.codigo_accion as string) ?? actionId).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40);
  return { filename: `expediente-${code}`, buffer };
}
