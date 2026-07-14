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
