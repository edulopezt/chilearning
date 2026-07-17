import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getPublicEnv } from "@/lib/env";
import type { HealthChecks } from "@/lib/observability/health";

/**
 * Sonda de liveness de la BD (task 3.7, D-035). Extraída del route /api/health
 * en la task 5.5 para que el tablero superadmin (HU-10.3) reporte la MISMA
 * salud que Uptime Kuma, sin duplicar la lógica ni el cliente.
 *
 * Sigue usando el cliente ANÓNIMO (barato, sin PII, sin service-role en un
 * endpoint público) y el timeout de 800 ms: una BD colgada degrada rápido en vez
 * de dejar la request pegada.
 *
 * ⚠ CAMBIO DE COMPORTAMIENTO DELIBERADO (task 5.5): la sonda original hacía
 * `from("tenants").select("id")` con el cliente anónimo, pero `anon` NO tiene
 * GRANT sobre `public.tenants` (es deny-by-default a propósito: lo afirma
 * isolation.rls.test.ts "anon no ve nada… 42501"). Es decir, la sonda devolvía
 * SIEMPRE 42501 → db:"fail" → status:"degraded" → /api/health respondía 503 en
 * TODOS los entornos, con la BD perfectamente sana. El test unitario solo cubría
 * `buildHealthPayload` (puro), así que nadie lo cazó. Verificado contra la BD
 * local antes de tocar nada.
 *
 * Se sondea con `tenant_status_by_slug`, la RPC que anon YA tiene concedida
 * (migración 20260717010000): es SECURITY DEFINER, expone SOLO el enum de estado
 * y con un slug centinela inexistente devuelve NULL sin error. Hace el viaje de
 * ida y vuelta a Postgres — que es justo lo que la sonda debe medir — sin
 * conceder ni un privilegio nuevo y sin tocar PII.
 */

const PROBE_TIMEOUT_MS = 800;

/** Slug centinela: no existe ni puede existir un tenant así. */
const PROBE_SLUG = "__healthcheck_probe__";

let anon: SupabaseClient | null = null;

function anonClient(): SupabaseClient {
  if (!anon) {
    const env = getPublicEnv();
    anon = createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { persistSession: false } });
  }
  return anon;
}

export async function probeDb(): Promise<HealthChecks["db"]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const probe = anonClient().rpc("tenant_status_by_slug", { p_slug: PROBE_SLUG });
    const timeout = new Promise<{ error: unknown }>((resolve) => {
      timer = setTimeout(() => resolve({ error: new Error("timeout") }), PROBE_TIMEOUT_MS);
      timer.unref?.();
    });
    const { error } = (await Promise.race([probe, timeout])) as { error: unknown };
    return error ? "fail" : "ok";
  } catch {
    return "fail";
  } finally {
    if (timer) clearTimeout(timer);
  }
}
