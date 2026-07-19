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
    // Anti-regresión del Hito 6 (task 6.15): estos literales fueron el inventario
    // mecánico de estilos hardcodeados que se migró a los primitivos de
    // src/components/ui/ en las ~64 páginas del overhaul. Prohibirlos aquí evita
    // que un PR futuro los reintroduzca fuera de los primitivos mismos (que SÍ
    // los encapsulan y quedan excluidos vía `ignores`).
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/bg-neutral-900|dark:bg-white/]",
          message:
            "Botón primario crudo: usa <Button> (variant por defecto) de @/components/ui/button.",
        },
        {
          selector: "Literal[value=/min-h-11 rounded-md border/]",
          message:
            "Input/select crudo: usa FieldRoot+FieldControl o Select de @/components/ui.",
        },
        {
          selector: "Literal[value=/text-(red|green|amber)-\\d00/]",
          message:
            "Color de estado crudo en texto: usa Alert (variant success/warning/destructive) o un token (text-success/text-warning/text-destructive).",
        },
        {
          selector: "Literal[value=/bg-(red|green|amber)-\\d00/]",
          message: "Badge/pill de estado crudo: usa <Badge variant=\"...\"> de @/components/ui/badge.",
        },
        {
          selector: "Literal[value=/(^|\\s)input(\\s|$)/]",
          message: "Clase legacy \".input\" (eliminada de globals.css): usa Field/Input/Select de @/components/ui.",
        },
        {
          selector: "JSXOpeningElement[name.name='table']",
          message: "Tabla cruda: usa Table/TableHeader/TableBody/TableRow/TableHead/TableCell de @/components/ui/table.",
        },
      ],
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
