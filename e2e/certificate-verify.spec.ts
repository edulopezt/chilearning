import { test, expect } from "@playwright/test";

import { CERT } from "./roles";

/**
 * Flujo #3 (task 3.8) — verificación PÚBLICA de certificado. Superficie de
 * seguridad clave (P4): un tercero valida el certificado sin sesión y ve datos
 * mínimos con el RUN ENMASCARADO — el RUN completo JAMÁS aparece. El cert lo
 * siembra `data.setup.ts`. Página sin autenticación (en PUBLIC_PATHS).
 */

test.describe("verificación pública de certificado", () => {
  test("token válido: muestra folio, nombre y RUN enmascarado; nunca el RUN completo", async ({ page }) => {
    const res = await page.goto(`/verificar/${CERT.token}`);
    expect(res?.status()).toBeLessThan(400);

    await expect(page.getByText(CERT.folio)).toBeVisible();
    await expect(page.getByText(CERT.studentName)).toBeVisible();
    await expect(page.getByText(CERT.runMasked)).toBeVisible();

    // El RUN COMPLETO no debe aparecer en ninguna parte de la página (P4).
    const html = await page.content();
    expect(html, "el RUN completo se filtró en la página pública").not.toContain(CERT.runFull);
  });

  test("token inexistente: no revienta (sin 500)", async ({ page }) => {
    const res = await page.goto("/verificar/token-que-no-existe-9999");
    expect(res?.status()).toBeLessThan(500);
  });
});
