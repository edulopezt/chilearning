import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

import { buildSecurityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // Build compacto para el contenedor de Coolify (ver Dockerfile).
  output: "standalone",
  experimental: {
    // Entregas de tareas (task 2.2): archivos hasta 20 MB por Server Action
    // (el bucket ya limita a 20 MB; +margen para el multipart). Ingesta
    // SCORM (task 5.1a): paquetes hasta 250 MB (`MAX_ZIP_BYTES` en
    // `scorm-service.ts`, mismo límite en el bucket `scorm`) — Next.js NO
    // permite acotar `bodySizeLimit` por ruta/Server Action, es un único
    // techo global, así que debe cubrir la subida más grande de la app.
    serverActions: {
      bodySizeLimit: "260mb",
      // CSRF de Server Actions (task 3.6): además del mismo-origen por defecto,
      // se permiten los subdominios de tenant (tras Traefik/Cloudflare el
      // x-forwarded-host puede diferir). Cualquier otro origen se rechaza.
      allowedOrigins: ["*.chilearning.cl", "*.localtest.me", "localhost:3000"],
    },
  },
  // Cabeceras de seguridad (task 3.6, Plan §9). CSP en Report-Only por ahora.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: buildSecurityHeaders(process.env).map((h) => ({ key: h.key, value: h.value })),
      },
    ];
  },
};

// Sentry (task 3.7): envuelve la config para instrumentar y (si hay AUTH token en
// CI) subir sourcemaps. Sin DSN/token no hace nada en runtime ni en build.
export default withSentryConfig(nextConfig, {
  org: "edulopezt",
  project: "chilearning",
  silent: !process.env.CI,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  disableLogger: true,
  // No subir sourcemaps si no hay token (dev/local): evita fallos de build.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});

