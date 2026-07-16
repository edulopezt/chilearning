/**
 * Chequeo de origen para mutaciones en route handlers propios (task 3.6). Puro.
 * Conservador (fail-open ante datos faltantes/malformados) para no romper
 * peticiones legítimas: solo BLOQUEA cuando el Origin existe y su dominio raíz
 * difiere del host de la petición (CSRF cross-site claro). El callback público
 * de SENCE queda EXENTO por diseño (POST cross-origin legítimo, ya protegido por
 * el nonce de sesión).
 */

/** Dominio raíz (últimas 2 etiquetas) de un host, sin puerto. */
export function rootDomain(host: string): string {
  const h = host.split(":")[0] ?? host;
  const parts = h.split(".");
  return parts.length <= 2 ? h : parts.slice(-2).join(".");
}

export function assertSameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return true; // sin datos: no bloquear.
  try {
    const originHost = new URL(origin).hostname;
    return rootDomain(originHost) === rootDomain(host);
  } catch {
    return true; // origin malformado: no bloquear (no es un CSRF construible).
  }
}
