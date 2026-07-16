/**
 * Cabeceras de seguridad (task 3.6, Plan §9/RNF-2). Puras: las aplica
 * `next.config.ts` en `headers()`. La CSP se emite en modo REPORT-ONLY por ahora
 * (no bloquea) — endurecerla a enforcing tras verificar en navegador con Edu; el
 * resto de cabeceras van enforcing (seguras para un despliegue HTTPS).
 *
 * `form-action` DEBE incluir `sistemas.sence.cl`: la página de auto-submit de
 * asistencia (renderAutoSubmitForm) hace un POST top-level hacia SENCE.
 */

export interface HeaderEntry {
  readonly key: string;
  readonly value: string;
}

/** Construye la CSP (string). No-prod agrega orígenes locales (mock/dev). */
export function buildCsp(isProd: boolean): string {
  const local = isProd ? "" : " http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*";
  const senceMock = isProd ? "" : " http://127.0.0.1:4010";
  const directives = [
    `default-src 'self'`,
    // Next App Router inyecta scripts inline de hidratación → 'unsafe-inline'.
    `script-src 'self' 'unsafe-inline'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https://*.b-cdn.net https://*.supabase.co`,
    `media-src 'self' https://*.b-cdn.net`,
    // Bunny player, YouTube-nocookie (lecciones), Supabase.
    `frame-src 'self' https://iframe.mediadelivery.net https://www.youtube-nocookie.com https://*.supabase.co`,
    `frame-ancestors 'self'`,
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io${local}`,
    `form-action 'self' https://sistemas.sence.cl${senceMock}`,
    `base-uri 'self'`,
    `object-src 'none'`,
  ];
  return directives.join("; ");
}

/** Todas las cabeceras de seguridad a aplicar a `/(.*)`. */
export function buildSecurityHeaders(env: Record<string, string | undefined>): HeaderEntry[] {
  const isProd = env.APP_ENV === "production";
  return [
    // HSTS SIN preload (reversible; todos los tenants son HTTPS por Cloudflare).
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    // Report-Only: no bloquea; se endurece a `Content-Security-Policy` tras verificar.
    { key: "Content-Security-Policy-Report-Only", value: buildCsp(isProd) },
  ];
}
