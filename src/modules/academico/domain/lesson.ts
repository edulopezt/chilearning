/**
 * Dominio puro de lecciones (task 1.4, HU-4.1). Valida la entrada del
 * constructor según el tipo. Sin IO.
 */

export const LESSON_KINDS = ["text", "video", "file", "embed", "scorm"] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export const LESSON_STATUSES = ["draft", "published"] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export interface LessonInput {
  title: string;
  kind: LessonKind;
  content: string;
  status: LessonStatus;
}

export type LessonField = "title" | "kind" | "content" | "status";
export interface LessonFieldError {
  field: LessonField;
  message: string;
}
export type LessonParseResult =
  | { ok: true; value: LessonInput }
  | { ok: false; errors: LessonFieldError[] };

const HTTPS_RE = /^https:\/\/[^\s]+$/;
// ID de video Bunny/YouTube (alfa-numérico con - _) o una URL https.
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
// `content` de una lección `scorm` es el UUID del `scorm_packages.id`.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseLessonInput(raw: {
  title?: unknown;
  kind?: unknown;
  content?: unknown;
  status?: unknown;
}): LessonParseResult {
  const errors: LessonFieldError[] = [];

  const title = String(raw.title ?? "").trim();
  if (title.length < 1 || title.length > 200) {
    errors.push({ field: "title", message: "El título es obligatorio (máx. 200 caracteres)." });
  }

  const kind = String(raw.kind ?? "") as LessonKind;
  if (!LESSON_KINDS.includes(kind)) {
    errors.push({ field: "kind", message: "Tipo de lección inválido." });
  }

  const content = String(raw.content ?? "").trim();
  if (kind === "text") {
    if (content === "") errors.push({ field: "content", message: "El texto de la lección no puede estar vacío." });
  } else if (kind === "video") {
    if (!VIDEO_ID_RE.test(content) && !HTTPS_RE.test(content)) {
      errors.push({ field: "content", message: "Ingresa el ID del video (Bunny) o una URL https." });
    }
  } else if (kind === "file" || kind === "embed") {
    if (!HTTPS_RE.test(content)) {
      errors.push({ field: "content", message: "Ingresa una URL https válida." });
    }
  } else if (kind === "scorm") {
    if (!UUID_RE.test(content)) {
      errors.push({ field: "content", message: "El paquete SCORM no es válido." });
    }
  }

  const status = String(raw.status ?? "draft") as LessonStatus;
  if (!LESSON_STATUSES.includes(status)) {
    errors.push({ field: "status", message: "Estado inválido." });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { title, kind, content, status } };
}
