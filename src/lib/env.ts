/**
 * Config PÚBLICA de entorno (client-safe). Evaluada de forma perezosa: falla al
 * USARSE, no al importar, para que `next build` sin `.env` (p.ej. el check de
 * CI) no reviente en el grafo de módulos.
 *
 * La config SOLO-SERVIDOR (service role, cifrado) vive en `env.server.ts`, que
 * importa `"server-only"` y no puede colarse a un bundle del browser.
 */

export function requiredEnv(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

export interface PublicEnv {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly tenantRootDomain: string;
}

/** Config pública (puede ir al browser). */
export function getPublicEnv(): PublicEnv {
  return {
    // Referencias directas a `process.env.NEXT_PUBLIC_*` para que el bundler de
    // Next las inline en el bundle del browser.
    supabaseUrl: requiredEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: requiredEnv(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
    tenantRootDomain: process.env.TENANT_ROOT_DOMAIN ?? "localtest.me",
  };
}
