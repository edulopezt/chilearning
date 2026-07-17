import { test, expect } from "@playwright/test";

import { AUTH } from "./roles";

/**
 * Smoke (task 3.8): valida el harness completo — build + boot + Supabase local +
 * login real + resolución de tenant por subdominio + carga de las landing por rol,
 * sin scroll horizontal a 360px (RNF-6). Es la red que blinda los merges (anti-#41:
 * un conflicto de rutas es error de RUNTIME que `next build` no caza).
 */

async function expectNoHorizontalScroll(page: import("@playwright/test").Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "hay scroll horizontal").toBeLessThanOrEqual(1);
}

test.describe("smoke — landing por rol", () => {
  test("público: /login carga y /verificar con token inválido no revienta", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    const res = await page.goto("/verificar/token-invalido-000");
    expect(res?.status()).toBeLessThan(500);
  });

  /**
   * Landing comercial (task 5.6). El `baseURL` del proyecto es un subdominio de
   * TENANT (`seminarea.localtest.me`), así que la landing hay que pedirla al
   * DOMINIO RAÍZ con URL absoluta: es el único host donde "/" es pública.
   */
  const ROOT_URL = (process.env.E2E_ROOT_URL ?? "http://localtest.me:3000").replace(/\/$/, "");

  /**
   * A 360px, que es el ancho que exige RNF-6 (el `mobile-chrome` del config es
   * Pixel 5 = 393px, 33px más holgado que el contrato).
   */
  test.describe("landing y privacidad — público", () => {
    test.use({ viewport: { width: 360, height: 780 } });

    /**
     * Blinda el punto frágil: "/" y "/privacidad" son PÚBLICAS en el dominio
     * raíz. Si alguien saca la raíz de `isPublicPath`, el middleware manda al
     * visitante a /login y el dominio deja de vender — un fallo mudo que ni el
     * build ni los unit tests cazan. Sin `storageState` = sin sesión.
     * Los textos no se afirman literales (viven en esCL y son marca
     * provisional): se usan roles y landmarks, que son el contrato de a11y.
     */
    test("dominio raíz: la landing carga sin sesión y lleva a /privacidad", async ({ page }) => {
      await page.goto(`${ROOT_URL}/`);
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);

      await page.getByRole("contentinfo").getByRole("link", { name: /privacidad/i }).click();
      await expect(page).toHaveURL(/\/privacidad/);
    });

    /**
     * La cara opuesta, y la razón por la que la exención de "/" mira el host:
     * en el subdominio de un OTEC la puerta es SU login, no el pitch comercial
     * del proveedor (que además mostraría la marca "Chilearning" ignorando el
     * branding del tenant, HU-1.10).
     */
    test("subdominio de tenant: la raíz manda al login, no a la landing", async ({ page }) => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator('input[type="email"]')).toBeVisible();
    });

    test("público: /privacidad carga sin sesión y avisa que es un borrador", async ({ page }) => {
      const res = await page.goto(`${ROOT_URL}/privacidad`);
      expect(res?.status()).toBeLessThan(400);
      await expect(page).not.toHaveURL(/\/login/);
      // El banner de borrador no es decorativo: sin él, el texto legal se leería
      // como la política vigente. Se acota a <main> porque Next monta su propio
      // role="alert" (el anunciador de rutas) fuera del contenido.
      await expect(page.getByRole("main").getByRole("alert")).toContainText(/BORRADOR/);
      await expectNoHorizontalScroll(page);
    });
  });

  test("alumno entra a /mi-curso", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.student });
    const page = await ctx.newPage();
    const res = await page.goto("/mi-curso");
    expect(res?.status()).toBeLessThan(400);
    await expect(page).not.toHaveURL(/\/login/);
    await ctx.close();
  });

  test("admin entra a /admin/acciones", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.admin });
    const page = await ctx.newPage();
    const res = await page.goto("/admin/acciones");
    expect(res?.status()).toBeLessThan(400);
    await expect(page).not.toHaveURL(/\/login/);
    await ctx.close();
  });

  test("coordinador entra al tablero sin scroll horizontal a 360px", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH.coordinator, viewport: { width: 360, height: 780 } });
    const page = await ctx.newPage();
    const res = await page.goto("/tablero");
    expect(res?.status()).toBeLessThan(400);
    await expect(page).not.toHaveURL(/\/login/);
    await expectNoHorizontalScroll(page);
    await ctx.close();
  });
});
