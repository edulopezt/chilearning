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
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io${local}`,
    `form-action 'self' https://sistemas.sence.cl${senceMock}`,
    `base-uri 'self'`,
    `object-src 'none'`,
  ];
  return directives.join("; ");
}

/**
 * CSP ENFORCED (no Report-Only) para las respuestas del proxy de assets SCORM
 * (`src/app/api/scorm/[packageId]/[...path]/route.ts`; mitigación del
 * hallazgo 4-ojos HIGH "autorizacion-proxy"/"spec-ux", task 5.1b). El SCO
 * corre en un iframe `allow-scripts allow-same-origin` porque necesita
 * alcanzar `window.parent.API` (SCORM RTE) — ADR-006. Esa combinación NO
 * queda cerrada por esta CSP: un script del paquete todavía puede leer/
 * escribir el DOM de `window.parent` y el localStorage del origen real (eso
 * exige sacar `allow-same-origin`, lo que a su vez rompe el discovery de
 * `window.API` y requiere el puente `postMessage` (`CrossFrameAPI`/
 * `CrossFrameLMS` que ya trae `scorm-again`) — rediseño pendiente, requiere
 * validación en navegador real antes de tocar el sandbox del iframe.
 * Esta CSP SÍ acota el daño mientras tanto: `connect-src 'none'` impide que
 * ese script haga fetch/XHR/beacon/WebSocket — ni para exfiltrar datos ni
 * para "actuar como el alumno" contra cualquier otra ruta de `/api/**` con su
 * sesión — y `frame-src`/`object-src`/`form-action` cierran las vías de
 * embeber o navegar hacia contenido de terceros.
 */
export function buildScormContentCsp(): string {
  const directives = [
    `default-src 'none'`,
    // El propio SCO (mismo origen vía el proxy) necesita ejecutar su JS.
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `media-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `frame-src 'self'`,
    `connect-src 'none'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
    `worker-src 'none'`,
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
