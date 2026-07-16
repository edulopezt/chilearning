/**
 * Scrubber de PII/secretos para eventos de Sentry (task 3.7, D-034). PURO y
 * testeable. Es la RED DE SEGURIDAD de que el token SENCE, RUN, correo y secretos
 * NUNCA salen del proceso hacia Sentry (RNF-10, regla dura SENCE). Se conecta como
 * `beforeSend` cuando Edu agregue el DSN (el SDK queda parqueado). Sin IO.
 */

// RUN chileno (con o sin puntos/guion). Cauto: puede sobre-redactar números; a
// propósito (preferimos perder un número a filtrar un RUN).
const RUN_RE = /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// Token del OTEC cifrado en reposo: `v<N>.<b64>.<b64>.<b64>` (AES-256-GCM). `v\d+`
// tolera rotación de esquema (v2…) sin dejar de redactar.
const ENCRYPTED_TOKEN_RE = /v\d+\.[A-Za-z0-9+/=_-]{8,}\.[A-Za-z0-9+/=_-]{8,}\.[A-Za-z0-9+/=_-]{8,}/g;
// JWT (service-role/anon key de Supabase, tokens…) y Bearer con secreto.
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const BEARER_RE = /[Bb]earer\s+[A-Za-z0-9._~+/=-]{12,}/g;
// Credenciales en URLs de conexión: postgres://user:PASS@host → redacta PASS.
const URL_CRED_RE = /([a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)[^@/\s]+@/gi;

// Claves cuyo VALOR se redacta completo. Predicado por patrón (más robusto que
// una lista y evita el literal de la service-role key, que un test de aislamiento
// exige que solo aparezca en tenant-guard). Incluye `token`/`key`/`secret` a
// secas: el token SENCE DESCIFRADO suele vivir en una var llamada `token`
// (4-ojos F1) y no tiene forma reconocible por regex de valor.
const SECRET_KEY_RE =
  /(token|secret|passw(or)?d|api[_.-]?key|access[_.-]?key|[_.-]key$|^key$|service[_.-]?role|encryption|webhook|bearer|credential|private[_.-]?key|^authorization$|^cookie$)/i;

function isSecretKey(k: string): boolean {
  return SECRET_KEY_RE.test(k);
}

/** Redacta patrones de PII/secreto dentro de un string. */
export function redactSecrets(input: string): string {
  return input
    .replace(ENCRYPTED_TOKEN_RE, "[REDACTED_TOKEN]")
    .replace(JWT_RE, "[REDACTED_JWT]")
    .replace(BEARER_RE, "Bearer [REDACTED]")
    .replace(URL_CRED_RE, "$1[REDACTED]@")
    .replace(EMAIL_RE, "[REDACTED_EMAIL]")
    .replace(RUN_RE, "[REDACTED_RUN]");
}

function deepRedact(value: unknown, depth: number): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map((v) => deepRedact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? "[REDACTED]" : deepRedact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface SentryEventLike {
  message?: unknown;
  request?: { cookies?: unknown; headers?: Record<string, unknown>; data?: unknown; url?: unknown } & Record<string, unknown>;
  exception?: unknown;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  [k: string]: unknown;
}

/** Limpia un evento de Sentry: quita cookies/headers sensibles, el body de las
 *  rutas SENCE (lleva el token), y redacta PII/secretos en toda la estructura. */
export function scrubSentryEvent(event: SentryEventLike): SentryEventLike {
  const e: SentryEventLike = { ...event };
  if (e.request && typeof e.request === "object") {
    const req = { ...e.request };
    delete req.cookies;
    if (req.headers && typeof req.headers === "object") {
      const h = { ...req.headers };
      for (const k of Object.keys(h)) {
        if (["authorization", "cookie"].includes(k.toLowerCase())) delete h[k];
      }
      req.headers = h;
    }
    // El body de /api/sence/* contiene el token del OTEC → nunca a Sentry.
    if (typeof req.url === "string" && req.url.includes("/api/sence")) delete req.data;
    e.request = req;
  }
  return deepRedact(e, 0) as SentryEventLike;
}
