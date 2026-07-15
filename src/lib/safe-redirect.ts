/**
 * Sanea el parámetro `next` de un redirect para evitar open-redirects. Solo se
 * aceptan rutas internas absolutas (empiezan con "/" pero no con "//" ni "/\",
 * que el navegador interpretaría como otro host). Cualquier otra cosa → fallback.
 * Puro (sin IO): usado por el callback de auth (task 1.9) y reutilizable.
 */
export function safeRedirectPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (typeof raw !== "string" || raw === "") return fallback;
  if (!raw.startsWith("/")) return fallback; // rutas relativas externas / esquemas
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback; // protocol-relative
  return raw;
}
