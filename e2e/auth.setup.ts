import { test as setup, expect } from "@playwright/test";

import { AUTH, PASSWORD, USERS } from "./roles";

/**
 * Autenticación por rol (task 3.8): login REAL por la UI y guardado del
 * `storageState` (cookies de `@supabase/ssr`). Cada spec reusa el estado del rol
 * que necesita. Usuarios y clave del seed local (`Password123!`).
 */

for (const { role, email } of USERS) {
  setup(`authenticate ${role}`, async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    // El login redirige fuera de /login al autenticar.
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
    await expect(page.locator("body")).toBeVisible();
    await page.context().storageState({ path: AUTH[role] });
  });
}
