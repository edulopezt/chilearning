import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Marcadores de Next.js: Next los provee en runtime; en vitest son no-op.
      "server-only": path.resolve(__dirname, "./test/empty-module.ts"),
      "client-only": path.resolve(__dirname, "./test/empty-module.ts"),
    },
  },
  test: {
    // Cada suite es un "project"; las de integración (RLS, mock SENCE) se
    // agregan como projects nuevos en las tareas 0.2 y 0.6.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.integration.test.ts", "src/**/*.rls.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "rls",
          environment: "node",
          include: ["src/**/*.rls.test.ts"],
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.integration.test.ts", "tools/**/*.integration.test.ts"],
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
