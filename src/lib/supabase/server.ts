import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getPublicEnv } from "@/lib/env";

/**
 * Cliente Supabase para Server Components / Route Handlers. Usa la sesión del
 * usuario (cookies) → queda SIEMPRE sujeto a RLS. Nunca bypassa nada.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const env = getPublicEnv();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Llamado desde un Server Component sin respuesta mutable: lo maneja
          // el middleware al refrescar la sesión. Es seguro ignorar aquí.
        }
      },
    },
  });
}
