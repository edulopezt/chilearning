import type { NextConfig } from "next";

import { buildSecurityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // Build compacto para el contenedor de Coolify (ver Dockerfile).
  output: "standalone",
  experimental: {
    // Entregas de tareas (task 2.2): archivos hasta 20 MB por Server Action
    // (el bucket ya limita a 20 MB; +margen para el multipart).
    serverActions: {
      bodySizeLimit: "25mb",
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

export default nextConfig;
