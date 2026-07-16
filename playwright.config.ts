import { defineConfig, devices } from "@playwright/test";

/**
 * E2E de los 3 flujos críticos (task 3.8, Plan §11). Corre la app REAL (`next
 * start`) contra Supabase local + mock SENCE. El tenant se resuelve por subdominio
 * vía `localtest.me` (DNS público → 127.0.0.1), así el host trae el slug del tenant.
 *
 * Auth = login real por UI + `storageState` por rol (ejercita `@supabase/ssr` + el
 * Auth Hook, no un JWT falso). Proyectos desktop (1440×900) y móvil (Pixel 5) — RNF-6.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://otec-andes.localtest.me:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "es-CL",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      dependencies: ["setup"],
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
      dependencies: ["setup"],
    },
  ],
  // Sin `E2E_NO_SERVER` levanta la app (asume `next build` previo). El env de
  // Supabase local lo pone el runner (CI o script) antes de arrancar.
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "pnpm start -p 3000 -H 127.0.0.1",
        url: `${BASE_URL}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
