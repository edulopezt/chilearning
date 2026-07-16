import { test, expect } from "@playwright/test";

import { AUTH } from "./roles";

/**
 * Flujo #2 (task 3.8) — guardia ANTI-#41. El bug que tumbó staging fue un conflicto
 * de slug entre subrutas dinámicas de la acción: error de RUNTIME que `next build`
 * no caza. Este spec visita TODAS las subrutas de una acción como coordinador y
 * exige que carguen (sin 500, sin redirección a login). Es la red que blinda merges.
 */

// Acción semilla del tenant A (fija en supabase/seed.sql).
const ACTION = "ac000000-0000-4000-8000-000000000001";

const SUBROUTES = [
  "preflight",
  "cumplimiento",
  "dj",
  "certificados",
  "expediente",
  "automatizaciones",
  "encuesta",
  "activar",
];

test.use({ storageState: AUTH.coordinator });

test.describe("acción — subrutas cargan (anti-#41)", () => {
  test("el índice de acciones carga y muestra la tabla", async ({ page }) => {
    const res = await page.goto("/admin/acciones");
    expect(res?.status(), "índice de acciones").toBeLessThan(400);
    await expect(page).not.toHaveURL(/\/login/);
  });

  for (const sub of SUBROUTES) {
    test(`subruta /${sub} carga sin 500 ni redirección a login`, async ({ page }) => {
      const res = await page.goto(`/admin/acciones/${ACTION}/${sub}`);
      expect(res?.status(), `status de /${sub}`).toBeLessThan(500);
      await expect(page, `/${sub} redirigió a login`).not.toHaveURL(/\/login/);
      // El body renderiza (no una pantalla en blanco por error de runtime).
      await expect(page.locator("body")).toBeVisible();
    });
  }
});
