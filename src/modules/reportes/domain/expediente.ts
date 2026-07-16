/**
 * Dominio puro del expediente de fiscalización (task 3.12, HU-5.10). Sin IO.
 * Checklist de completitud por acción, requisitos por línea SENCE (flagged) y las
 * filas del manifiesto del ZIP.
 */

export const DOC_TYPES = [
  "orden_compra_otic", "comunicacion", "rectificacion", "nomina", "dj", "certificado", "evidencia", "otro",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  orden_compra_otic: "Orden de compra OTIC",
  comunicacion: "Comunicación",
  rectificacion: "Rectificación",
  nomina: "Nómina",
  dj: "Declaración Jurada",
  certificado: "Certificado",
  evidencia: "Evidencia",
  otro: "Otro",
};

const ALLOWED_MIME = new Set([
  "application/pdf", "image/png", "image/jpeg", "application/zip",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const MAX_SIZE = 52_428_800; // 50 MB

export interface FieldError {
  readonly field: string;
  readonly message: string;
}
export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

export interface DocumentInput {
  readonly docType: DocType;
  readonly title: string;
  readonly documentDate: string | null;
}

export function parseDocumentInput(raw: { docType?: unknown; title?: unknown; documentDate?: unknown }): ParseResult<DocumentInput> {
  const errors: FieldError[] = [];
  const docType = String(raw.docType ?? "") as DocType;
  if (!DOC_TYPES.includes(docType)) errors.push({ field: "docType", message: "Tipo de documento inválido." });
  const title = String(raw.title ?? "").trim();
  if (title.length < 1 || title.length > 200) errors.push({ field: "title", message: "El título es obligatorio (máx. 200)." });
  const dateRaw = String(raw.documentDate ?? "").trim();
  const documentDate = dateRaw === "" ? null : dateRaw;
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { docType, title, documentDate } };
}

export function validateExpedienteFile(file: { size: number; type: string }): { ok: boolean; error?: string } {
  if (!ALLOWED_MIME.has(file.type)) return { ok: false, error: "mime" };
  if (file.size <= 0 || file.size > MAX_SIZE) return { ok: false, error: "size" };
  return { ok: true };
}

/** Nombre de archivo seguro (sin separadores ni caracteres raros). */
export function safeFileSlug(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || "archivo";
}

// Requisitos por línea (línea 3 franquicia = default). FLAGGED para revisión normativa.
export const REQUIRED_TYPES_BY_LINE: Record<number, readonly DocType[]> = {
  1: ["comunicacion", "nomina", "dj"],
  3: ["orden_compra_otic", "comunicacion", "nomina", "dj", "certificado"],
  6: ["comunicacion", "nomina", "dj"],
};

export interface ExpedienteDoc {
  readonly docType: DocType;
  readonly isDefinitive: boolean;
}

export interface ChecklistRow {
  readonly docType: DocType;
  readonly present: boolean;
  readonly count: number;
  readonly hasDefinitive: boolean;
}

export function expedienteChecklist(docs: readonly ExpedienteDoc[], line: number): ChecklistRow[] {
  const required = REQUIRED_TYPES_BY_LINE[line] ?? REQUIRED_TYPES_BY_LINE[3]!;
  return required.map((docType) => {
    const forType = docs.filter((d) => d.docType === docType);
    return {
      docType,
      present: forType.length > 0,
      count: forType.length,
      hasDefinitive: forType.some((d) => d.isDefinitive),
    };
  });
}

export function completeness(docs: readonly ExpedienteDoc[], line: number): { done: number; total: number; complete: boolean } {
  const checklist = expedienteChecklist(docs, line);
  const done = checklist.filter((c) => c.present).length;
  return { done, total: checklist.length, complete: done === checklist.length };
}

export interface ManifestDoc {
  readonly docType: DocType;
  readonly title: string;
  readonly status: string;
  readonly isDefinitive: boolean;
  readonly documentDate: string | null;
  readonly fileName: string;
}

export function manifestRows(docs: readonly ManifestDoc[]): string[][] {
  return docs.map((d) => [
    DOC_TYPE_LABEL[d.docType] ?? d.docType,
    d.title,
    d.status,
    d.isDefinitive ? "definitivo" : "borrador",
    d.documentDate ?? "",
    d.fileName,
  ]);
}
