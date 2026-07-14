/**
 * Resolución de tenant por subdominio (dominio puro, sin IO) — task 0.4.
 * Deriva el `slug` del OTEC desde el host de la request. El middleware lo cruza
 * contra la BD; aquí solo va la lógica pura y testeable.
 */

/** Slugs que NUNCA se asignan a un tenant (HU-1.1). */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "www",
  "app",
  "api",
  "admin",
  "staging",
  "status",
  "mail",
  "cdn",
  "docs",
  "assets",
  "static",
]);

/** Regla de slug del spec: minúsculas, 3–30, letras/números/guiones, sin guiones al borde. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

export function isValidTenantSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug);
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

export interface TenantHostResolution {
  /** El slug candidato, o null si el host no corresponde a un subdominio de tenant. */
  readonly slug: string | null;
  /** True si el host es exactamente el dominio raíz (sin subdominio). */
  readonly isRootDomain: boolean;
  /** True si el subdominio es un nombre reservado (no es un tenant). */
  readonly isReserved: boolean;
}

/**
 * Extrae el slug del tenant desde el host.
 * @param host      Host de la request (puede traer `:puerto`).
 * @param rootDomain Dominio raíz configurado (ej. `chilearning.cl`,
 *                   `localtest.me`, o `216.185.51.57.sslip.io`).
 */
export function resolveTenantFromHost(
  host: string | null | undefined,
  rootDomain: string,
): TenantHostResolution {
  const empty: TenantHostResolution = { slug: null, isRootDomain: false, isReserved: false };
  if (!host || !rootDomain) return empty;

  // Normaliza: minúsculas, sin puerto.
  const cleanHost = host.toLowerCase().split(":")[0]?.trim() ?? "";
  const cleanRoot = rootDomain.toLowerCase().split(":")[0]?.trim() ?? "";
  if (!cleanHost || !cleanRoot) return empty;

  if (cleanHost === cleanRoot) {
    return { slug: null, isRootDomain: true, isReserved: false };
  }

  const suffix = `.${cleanRoot}`;
  if (!cleanHost.endsWith(suffix)) {
    // Host ajeno al dominio raíz (ej. acceso directo por IP): sin tenant.
    return empty;
  }

  const label = cleanHost.slice(0, -suffix.length);
  // Solo un nivel de subdominio es un tenant (`a.b.root` no lo es).
  if (label.includes(".")) return empty;

  if (RESERVED_SLUGS.has(label)) {
    return { slug: null, isRootDomain: false, isReserved: true };
  }
  if (!SLUG_RE.test(label)) return empty;

  return { slug: label, isRootDomain: false, isReserved: false };
}
