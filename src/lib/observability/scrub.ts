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
// Token del OTEC cifrado en reposo: formato `v1.<b64>.<b64>.<b64>` (AES-256-GCM).
const ENCRYPTED_TOKEN_RE = /v1\.[A-Za-z0-9+/=_-]{8,}\.[A-Za-z0-9+/=_-]{8,}\.[A-Za-z0-9+/=_-]{8,}/g;

const SECRET_KEYS = new Set([
  "SENCE_TOKEN_ENCRYPTION_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "N8N_WEBHOOK_SECRET",
  "R2_SECRET_ACCESS_KEY",
  "R2_ACCESS_KEY_ID",
  "RESEND_API_KEY",
  "STAGING_DEMO_PASSWORD",
  "token_encrypted",
  "password",
  "authorization",
  "cookie",
]);

/** Redacta patrones de PII/secreto dentro de un string. */
export function redactSecrets(input: string): string {
  return input
    .replace(ENCRYPTED_TOKEN_RE, "[REDACTED_TOKEN]")
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
      out[k] = SECRET_KEYS.has(k) ? "[REDACTED]" : deepRedact(v, depth + 1);
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
