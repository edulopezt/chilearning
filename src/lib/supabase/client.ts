"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getPublicEnv } from "@/lib/env";

/** Cliente Supabase para componentes del browser. Sujeto a RLS. */
export function createSupabaseBrowserClient(): SupabaseClient {
  const env = getPublicEnv();
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
}
