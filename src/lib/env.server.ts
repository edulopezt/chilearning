import "server-only";

import { requiredEnv } from "@/lib/env";
import { senceTimingFromEnv } from "@/modules/sence/domain/timing";

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
  // Knobs operativos I-13/D-003 (3 h / 60 min y política de alertas). Un valor
  // inválido cae al default del contrato; se avisa una vez por lectura.
  const timing = senceTimingFromEnv(process.env);
  if (timing.invalidKeys.length > 0) {
    console.warn("[sence] env de timing inválida; se usan defaults", {
      keys: timing.invalidKeys,
    });
  }
  return {
    tokenEncryptionKey: requiredEnv(
      "SENCE_TOKEN_ENCRYPTION_KEY",
      process.env.SENCE_TOKEN_ENCRYPTION_KEY,
    ),
    mode: senceEnvValue,
    mockUrl: process.env.SENCE_MOCK_URL ?? "http://127.0.0.1:4010",
    timing,
  } as const;
}
