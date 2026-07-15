import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const SIBLING_MODULES = [
  "core",
  "academico",
  "contenido",
  "evaluacion",
  "certificados",
  "portal-empresa",
  "comunicacion",
  "reportes",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "next-env.d.ts",
    "coverage/**",
    // Material de referencia AGPLv3 — solo lectura, jamás parte de la app (ver NOTICE.md):
    "block_sence/**",
    "integracion-sence-portable/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // src/modules/sence es SAGRADO: aislado, sin dependencias hacia otros módulos
    // (plan técnico §2, ADR). Bloquea imports por alias y los escapes relativos.
    files: ["src/modules/sence/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules/*", "!@/modules/sence", "!@/modules/sence/**"],
              message:
                "src/modules/sence debe permanecer aislado: no puede importar de otros módulos.",
            },
            {
              group: SIBLING_MODULES.flatMap((m) => [`../${m}/**`, `../../${m}/**`]),
              message:
                "src/modules/sence debe permanecer aislado: no puede importar de otros módulos (ni por ruta relativa).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
