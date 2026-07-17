/**
 * Resolución de tenant por subdominio (dominio puro, sin IO) — task 0.4.
 * Deriva el `slug` del OTEC desde el host de la request. El middleware lo cruza
 * contra la BD; aquí solo va la lógica pura y testeable.
 * Task 5.3 agrega la validación de alta de tenant (HU-1.1) y los flags por
 * defecto (HU-1.3).
 */
import { z } from "zod";

import { FEATURE_KEYS, type FeatureKey } from "@/modules/core/domain/features";

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

/** Planes comerciales disponibles (HU-1.1). */
export const TENANT_PLANS = ["standard", "pro", "enterprise"] as const;

export type TenantPlan = (typeof TENANT_PLANS)[number];

/**
 * Configuración por defecto SEGURA de un tenant nuevo (HU-1.1): toda feature
 * nace APAGADA (deny-by-default, P7); el superadmin las enciende por tenant.
 */
export const DEFAULT_TENANT_FLAGS: Readonly<Record<FeatureKey, boolean>> = Object.freeze(
  Object.fromEntries(FEATURE_KEYS.map((key) => [key, false])) as Record<FeatureKey, boolean>,
);

/** Alta de tenant por el superadmin (HU-1.1). Valida en el borde (Zod). */
export const createTenantSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .regex(SLUG_RE)
    .refine((s) => !RESERVED_SLUGS.has(s), { message: "slug reservado" }),
  plan: z.enum(TENANT_PLANS),
  adminEmail: z.string().trim().email().max(320),
  rut: z
    .string()
    .trim()
    .max(12)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

/**
 * Rutas que la suspensión NUNCA intercepta (revisión 4-ojos de la task 5.3):
 * - `/api/sence`: el callback SENCE debe llegar SIEMPRE a su handler (I-1:
 *   todo POST se persiste; SENCE no reintenta — interceptarlo pierde asistencia
 *   de sesiones en vuelo de forma irrecuperable).
 * - `/api/health`: el monitoreo (Kuma) no puede recibir HTML 200 del aviso.
 * - `/verificar`: verificación pública de certificados por terceros — la
 *   suspensión bloquea el acceso pero "los datos quedan intactos" (HU-1.4).
 */
const SUSPENSION_EXEMPT_PREFIXES = ["/api/sence", "/api/health", "/verificar"] as const;

export type SuspendedRequestAction = "allow" | "block_api" | "rewrite";

/**
 * Decide qué hace el middleware con una request a un tenant SUSPENDIDO:
 * - "allow": endpoints exentos (arriba) o la propia página de aviso.
 * - "block_api": el resto de `/api/*` recibe 403 JSON explícito (jamás el HTML
 *   del aviso reescrito, que engaña a clientes de máquina).
 * - "rewrite": requests de documento → página `/suspendido`.
 */
export function suspendedRequestAction(pathname: string): SuspendedRequestAction {
  if (pathname === "/suspendido") return "allow";
  if (SUSPENSION_EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return "allow";
  }
  if (pathname === "/api" || pathname.startsWith("/api/")) return "block_api";
  return "rewrite";
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
