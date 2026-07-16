import { test, expect } from "@playwright/test";

import { AUTH, SURVEY } from "./roles";

/**
 * Flujo #1 (task 3.8) — el alumno responde la encuesta de satisfacción (HU-6.3).
 * La encuesta publicada la siembra `data.setup.ts` para un curso donde el alumno
 * semilla está inscrito. Se elige un valor de la escala y se envía; al confirmar,
 * el formulario se reemplaza por el acuse (los radios desaparecen).
 */

test.use({ storageState: AUTH.student });

test("el alumno responde la encuesta publicada y ve la confirmación", async ({ page }) => {
  const res = await page.goto(`/mi-curso/encuesta/${SURVEY.id}`);
  expect(res?.status()).toBeLessThan(400);
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByText(SURVEY.title)).toBeVisible();

  // Escala 1..5: el radio es sr-only, se marca con force; el onChange actualiza el estado.
  const radios = page.locator(`input[name="radio-${SURVEY.questionId}"]`);
  await expect(radios).toHaveCount(5);
  await radios.nth(4).check({ force: true });

  await page.locator('button[type="submit"]').click();

  // Al enviar OK el formulario se reemplaza por el acuse: los radios ya no existen.
  await expect(radios).toHaveCount(0);
});
