import { test } from "@playwright/test";

import { AUTH } from "./roles";

/**
 * Captura visual de referencia para la revisión adversarial de cierre del
 * Hito 6 (task 6.15) — NO es un gate de CI ni hace pixel-diff contra un
 * baseline: solo guarda capturas en `playwright-visual/` para que un agente
 * revisor las lea. Gated por `VISUAL=1` (nunca corre en el pipeline normal).
 *
 * Cobertura real (no las "64 páginas" nominales del plan original): páginas
 * públicas + las 3 áreas con `storageState` sembrado en `roles.ts` (admin,
 * coordinator/tablero, student/mi-curso). Los portales supervisor/empresa/
 * superadmin NO tienen usuario sembrado en el harness E2E y quedan fuera —
 * capturarlos requeriría sembrar sesiones nuevas, fuera del alcance de este
 * PR de polish (REGLA DE HONESTIDAD: no se afirma cobertura que no existe).
 */

test.skip(!process.env.VISUAL, "gated por VISUAL=1 — captura de referencia, no corre en CI normal");

const ROOT_URL = (process.env.E2E_ROOT_URL ?? "http://localtest.me:3000").replace(/\/$/, "");

// IDs semilla fijos (supabase/seed.sql y e2e/data.setup.ts) — nunca random.
const ACTION = "ac000000-0000-4000-8000-000000000001";
const COURSE = "5c0000c0-0000-4000-8000-000000000001";

const ACTION_SUBROUTES = [
  "preflight",
  "cumplimiento",
  "dj",
  "certificados",
  "expediente",
  "automatizaciones",
  "encuesta",
  "activar",
];

const VIEWPORTS = [
  { label: "360", width: 360, height: 900 },
  { label: "1440", width: 1440, height: 900 },
] as const;

const THEMES = ["light", "dark"] as const;

function fileFor(theme: string, viewport: string, path: string): string {
  const safe = (path.replace(/^\//, "").replace(/\//g, "_") || "root").slice(0, 120);
  return `playwright-visual/${theme}-${viewport}/${safe}.png`;
}

async function shoot(
  page: import("@playwright/test").Page,
  theme: (typeof THEMES)[number],
  viewport: (typeof VIEWPORTS)[number],
  path: string,
  absoluteUrl?: string,
): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.addInitScript(
    (t) => window.localStorage.setItem("chilearning-theme", t),
    theme,
  );
  await page.goto(absoluteUrl ?? path);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: fileFor(theme, viewport.label, path), fullPage: true });
}

const PUBLIC_PAGES = ["/login", "/privacidad"];

const ADMIN_PAGES = [
  "/dashboard",
  "/admin/cursos",
  `/admin/cursos/${COURSE}/lecciones`,
  "/admin/acciones",
  ...ACTION_SUBROUTES.map((s) => `/admin/acciones/${ACTION}/${s}`),
  "/admin/inscripciones",
  "/admin/sence",
  "/admin/marca",
  "/admin/correos",
  "/admin/mensajes",
  "/admin/derechos",
  "/admin/supervisores",
  "/admin/empresas",
  "/admin/certificados/vencimientos",
  "/admin/exportacion",
  "/admin/tutor-ia",
];

const COORDINATOR_PAGES = ["/tablero", "/tablero/notas", "/tablero/entregas"];

const STUDENT_PAGES = ["/mi-curso", "/mi-curso/certificados", "/mi-curso/comunicacion", "/mis-datos", "/preferencias"];

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test.describe(`visual — público — ${theme} @ ${viewport.label}`, () => {
      for (const path of PUBLIC_PAGES) {
        test(`captura ${path}`, async ({ page }) => {
          await shoot(page, theme, viewport, path);
        });
      }
      test("captura landing (dominio raíz)", async ({ page }) => {
        await shoot(page, theme, viewport, "/", `${ROOT_URL}/`);
      });
    });

    test.describe(`visual — admin — ${theme} @ ${viewport.label}`, () => {
      test.use({ storageState: AUTH.admin });
      for (const path of ADMIN_PAGES) {
        test(`captura ${path}`, async ({ page }) => {
          await shoot(page, theme, viewport, path);
        });
      }
    });

    test.describe(`visual — coordinador (tablero) — ${theme} @ ${viewport.label}`, () => {
      test.use({ storageState: AUTH.coordinator });
      for (const path of COORDINATOR_PAGES) {
        test(`captura ${path}`, async ({ page }) => {
          await shoot(page, theme, viewport, path);
        });
      }
    });

    test.describe(`visual — alumno (mi-curso) — ${theme} @ ${viewport.label}`, () => {
      test.use({ storageState: AUTH.student });
      for (const path of STUDENT_PAGES) {
        test(`captura ${path}`, async ({ page }) => {
          await shoot(page, theme, viewport, path);
        });
      }
    });
  }
}
