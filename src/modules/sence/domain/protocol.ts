import { createHash } from "node:crypto";

/**
 * Constantes y helpers puros del protocolo RCE (sin IO) — task 0.7.
 * Endpoints y derivaciones deterministas. La config real (ambiente por acción)
 * la resuelve el servicio; aquí solo van las tablas y funciones puras.
 */

export type SenceEnvironment = "rcetest" | "rce";
export type SencePhase = "start" | "close";

/** Endpoints oficiales (manual v1.1.6, Anexo 1). Base configurable para el mock. */
export const SENCE_BASE_URL = {
  rcetest: "https://sistemas.sence.cl/rcetest",
  rce: "https://sistemas.sence.cl/rce",
} as const;

export function resolveEndpoint(
  environment: SenceEnvironment,
  phase: SencePhase,
  baseOverride?: string,
): string {
  const base = baseOverride ?? SENCE_BASE_URL[environment];
  const path = phase === "start" ? "/Registro/IniciarSesion" : "/Registro/CerrarSesion";
  return `${base}${path}`;
}

/**
 * Origin público de la app, del que cuelga `UrlRetoma`/`UrlError`. Detrás de un
 * proxy (Traefik/Coolify) que termina TLS y reenvía HTTP al contenedor,
 * `request.url` puede salir como `http://host-interno`, lo que haría a SENCE
 * rechazar la URL (202/203) o llamar a un callback inseguro (I-8).
 *
 * SEGURIDAD: un cliente puede FALSEAR `x-forwarded-host`/`Host` en su propia
 * request. Confiar en ellos a ciegas abriría un open-redirect del callback de
 * SENCE (desvío del `IdSesionSence`). Por eso el host reenviado se acepta SOLO
 * si es el dominio raíz o un subdominio suyo — el mismo criterio que
 * `resolveTenantFromHost` en el middleware — y el esquema se FUERZA a `https`
 * (SENCE lo exige). El hostname se parsea como URL para descartar puerto,
 * userinfo (`a@b`) y path (anti-bypass).
 *
 * FAIL-CLOSED (H4-R-015): si el host reenviado NO valida, se ancla al origin
 * CANÓNICO de configuración (`canonicalOrigin`, siempre https) — NUNCA se refleja
 * `request.url`, que tras el proxy sale como `http://host-interno` y que un
 * cliente puede influir con un `Host` bogus (self-exfil del `IdSesionSence` o
 * self-DoS por un callback no-https). Función pura (sin IO): tanto el dominio
 * raíz como el origin canónico entran por parámetro (aislamiento del módulo, I-16).
 */
export function resolvePublicOrigin(
  header: (name: string) => string | null | undefined,
  canonicalOrigin: string,
  allowedRootDomain: string,
): string {
  const first = (v: string | null | undefined): string | undefined =>
    v?.split(",")[0]?.trim() || undefined;
  const rawHost = first(header("x-forwarded-host")) ?? first(header("host"));
  const host = rawHost ? safeHostname(rawHost) : undefined;
  const root = allowedRootDomain.toLowerCase().split(":")[0]?.trim() ?? "";
  if (host && root && (host === root || host.endsWith(`.${root}`))) {
    return `https://${host}`;
  }
  // Solo el origin del canónico (descarta cualquier path/trailing slash).
  return new URL(canonicalOrigin).origin;
}

/** Hostname limpio (sin puerto/userinfo/path) o undefined si no parsea. */
function safeHostname(rawHost: string): string | undefined {
  try {
    return new URL(`https://${rawHost}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Hash de deduplicación de un callback (I-3), sobre el payload COMPLETO
 * normalizado (claves ordenadas + el `kind` clasificado). Sirve para DETECTAR
 * replays en la bitácora; NO los bloquea (el índice es no-único, hallazgo C-1):
 * un replay legítimo igual persiste un segundo evento (I-1) y la idempotencia
 * de la transición la da la máquina de estados. Cubrir todo el payload lo hace
 * un detector fiel (hallazgo L-2): dos callbacks realmente distintos difieren.
 */
export function computeDedupeHash(payload: Record<string, unknown>, kind: string): string {
  const normalized = Object.keys(payload)
    .map((k) => k.trim())
    .filter((k) => k.toLowerCase() !== "token")
    .sort()
    .map((k) => `${k}=${String(payload[k] ?? payload[`${k} `] ?? "")}`)
    .join("&");
  return createHash("sha256").update(`${kind}|${normalized}`).digest("hex");
}

/**
 * Genera un `IdSesionAlumno` único (≤149 chars) a partir de un uuid. Prefijo
 * legible para depurar en la bitácora sin exponer datos personales.
 */
export function buildIdSesionAlumno(uuid: string): string {
  const id = `chl-${uuid}`;
  return id.slice(0, 149);
}

/** Quita cualquier campo Token del payload antes de persistir (I-7). Recorta la
 *  clave (SENCE a veces envía nombres con espacios, ej. "LineaCapacitacion "). */
export function stripToken(payload: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k.trim().toLowerCase() === "token") continue;
    clean[k] = v;
  }
  return clean;
}

/**
 * Lee un campo del callback tolerando nombres con espacios colgantes (H4-R-001):
 * SENCE puede enviar `"IdSesionAlumno "` (errata del manual, Anexo 3; regla de
 * precedencia §1.2: "tolerar nombres de campo con espacios colgantes" al RECIBIR).
 * Prueba primero la clave exacta y, si no está, la primera clave cuyo `trim()`
 * coincida — así el correlador/clasificador ve el valor aunque la clave venga con
 * espacios, y el payload CRUDO (con sus claves originales) se persiste intacto (I-1).
 * Espeja lo que `computeDedupeHash`/`stripToken` ya hacen con las claves.
 */
export function pickField(
  params: Record<string, string>,
  name: string,
): string | undefined {
  const exact = params[name];
  if (exact !== undefined) return exact;
  for (const k of Object.keys(params)) {
    if (k.trim() === name) return params[k];
  }
  return undefined;
}

/** Parsea la `FechaHora` de SENCE (`aaaa-mm-dd hh:mm:ss`, hora Chile) a epoch ms. */
export function parseFechaHora(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  // Interpreta como hora local del servidor; el offset exacto de Chile se
  // preserva aparte en ZonaHoraria. Para el motor basta un instante monotónico.
  const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
  return Number.isNaN(ms) ? null : ms;
}
