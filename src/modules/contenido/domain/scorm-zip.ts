/**
 * Validaciones puras (sin IO) del contenido de un paquete SCORM (task 5.1a,
 * HU-4.2, ADR-006): rutas de las entries del .zip, presupuesto de bytes
 * descomprimidos (anti zip-bomb), mapa de content-type y saneo de ruta para
 * el proxy de assets extraídos (que consumirá el reproductor, PR 5.1b).
 */

export const MAX_ZIP_FILES = 5000;
export const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024; // 500 MB
export const MAX_SCORM_PATH_LENGTH = 1024;

export type ZipEntriesError = "unsafe_path" | "too_many_files";
export type ZipEntriesResult = { ok: true } | { ok: false; error: ZipEntriesError };

/** ¿Es esta ruta cruda (tal como venía en el .zip) insegura? */
function isUnsafePath(raw: string): boolean {
  if (typeof raw !== "string" || raw.length === 0) return true;
  if (raw.includes("\\")) return true; // backslash: no se admite (Windows-style)
  if (/^[a-zA-Z]:/.test(raw)) return true; // ruta absoluta tipo "C:\..."
  if (raw.startsWith("/")) return true; // ruta absoluta unix
  const segments = raw.split("/");
  return segments.some((s) => s === "..");
}

/**
 * Valida las rutas CRUDAS de todas las entries de un .zip (antes de subir NADA
 * a Storage): rechaza traversal (`..`), rutas absolutas, backslashes y más de
 * `MAX_ZIP_FILES` archivos.
 */
export function validateZipEntries(paths: readonly string[]): ZipEntriesResult {
  if (paths.length > MAX_ZIP_FILES) return { ok: false, error: "too_many_files" };
  for (const p of paths) {
    if (isUnsafePath(p)) return { ok: false, error: "unsafe_path" };
  }
  return { ok: true };
}

/** Guardia anti zip-bomb: la suma de bytes DESCOMPRIMIDOS declarados por cada entry. */
export function exceedsUncompressedBudget(totalUncompressedBytes: number): boolean {
  return totalUncompressedBytes > MAX_UNCOMPRESSED_BYTES;
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  js: "text/javascript",
  css: "text/css",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  woff: "font/woff",
  woff2: "font/woff2",
  json: "application/json",
  xml: "application/xml",
  txt: "text/plain",
  ico: "image/x-icon",
};

export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
  return CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
}

// Detección INTENCIONAL de caracteres de control (0x00–0x1F) en la ruta.
const CONTROL_CHARS_RE = /[\x00-\x1f]/;

export type SanitizeScormPathResult = { ok: true; value: string } | { ok: false };

/**
 * Normaliza una ruta de asset SCORM para servirla vía proxy (PR 5.1b): colapsa
 * "./" y valida ausencia de ".." TRAS normalizar, rechaza "//", caracteres de
 * control y una longitud excesiva. Rutas absolutas o con backslash: inseguras.
 */
export function sanitizeScormPath(raw: string): SanitizeScormPathResult {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_SCORM_PATH_LENGTH) return { ok: false };
  if (CONTROL_CHARS_RE.test(raw)) return { ok: false };
  if (raw.includes("//")) return { ok: false };
  if (raw.includes("\\")) return { ok: false };
  if (/^[a-zA-Z]:/.test(raw) || raw.startsWith("/")) return { ok: false };

  const segments = raw.split("/").filter((s) => s !== "." && s !== "");
  if (segments.length === 0) return { ok: false };
  if (segments.some((s) => s === "..")) return { ok: false };

  return { ok: true, value: segments.join("/") };
}
