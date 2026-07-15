import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build compacto para el contenedor de Coolify (ver Dockerfile).
  output: "standalone",
  experimental: {
    // Entregas de tareas (task 2.2): archivos hasta 20 MB por Server Action
    // (el bucket ya limita a 20 MB; +margen para el multipart).
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
