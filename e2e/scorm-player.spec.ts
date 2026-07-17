import { test, expect } from "@playwright/test";

import { AUTH, SCORM } from "./roles";

/**
 * Reproductor SCORM (task 5.1b, HU-4.2, ADR-006) — smoke, NO simula scorm-again
 * completo (eso son los unit/integration tests): solo confirma que la página
 * del alumno carga (candado abierto, paquete `ready`) y que el iframe apunta a
 * un asset SAME-ORIGIN que el proxy autenticado sirve con 200 — la propiedad
 * crítica de la que depende TODO lo demás (si esto fallara, `window.API`
 * jamás sería alcanzable por el SCO y el reproductor no podría reportar
 * progreso, ver PLAN.md del PR).
 */
test.use({ storageState: AUTH.student });

test("la página del reproductor carga y el asset del proxy responde 200", async ({ page }) => {
  const res = await page.goto(`/mi-curso/scorm/${SCORM.lessonId}`);
  expect(res?.status()).toBeLessThan(400);
  await expect(page).not.toHaveURL(/\/login/);

  const iframe = page.locator("iframe");
  await expect(iframe).toHaveCount(1);
  const src = await iframe.getAttribute("src");
  expect(src, "el iframe debe tener un src same-origin hacia /api/scorm/…").toBeTruthy();
  expect(src).toMatch(new RegExp(`^/api/scorm/${SCORM.packageId}/`));

  // Mismo contexto de navegador (comparte cookies de sesión): confirma que el
  // proxy same-origin sirve el asset YA AUTENTICADO con 200.
  const assetRes = await page.request.get(src!);
  expect(assetRes.status()).toBe(200);
  expect(assetRes.headers()["content-type"]).toContain("text/html");
});
