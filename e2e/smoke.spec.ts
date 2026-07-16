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
