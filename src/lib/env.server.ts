import "server-only";

import { requiredEnv } from "@/lib/env";

/**
 * Config SOLO-SERVIDOR. `import "server-only"` hace que el build FALLE si algún
 * componente cliente la importa (defensa en tiempo de compilación, no solo en
 * runtime): el service role bypassa RLS y jamás debe salir del servidor.
 */
export function serverEnv() {
  return {
    supabaseUrl: requiredEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseServiceRoleKey: requiredEnv(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
  } as const;
}

/**
 * Config solo-servidor del motor SENCE. `SENCE_ENV` decide contra qué se habla:
 * `mock` (dev/CI, usa `SENCE_MOCK_URL`), `test` (rcetest) o `prod` (rce).
 */
export function senceEnv() {
  const senceEnvValue = (process.env.SENCE_ENV ?? "mock") as "mock" | "test" | "prod";
  return {
    tokenEncryptionKey: requiredEnv(
      "SENCE_TOKEN_ENCRYPTION_KEY",
      process.env.SENCE_TOKEN_ENCRYPTION_KEY,
    ),
    mode: senceEnvValue,
    mockUrl: process.env.SENCE_MOCK_URL ?? "http://127.0.0.1:4010",
  } as const;
}
