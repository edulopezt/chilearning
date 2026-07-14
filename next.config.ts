import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build compacto para el contenedor de Coolify (ver Dockerfile).
  output: "standalone",
};

export default nextConfig;
