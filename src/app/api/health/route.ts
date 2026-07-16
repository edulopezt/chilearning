import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getPublicEnv } from "@/lib/env";
import { buildHealthPayload, type HealthChecks, type HealthPayload } from "@/lib/observability/health";

export const dynamic = "force-dynamic";

/**
 * GET /api/health (task 3.7, D-035): healthcheck público para Uptime Kuma y el
 * HEALTHCHECK del contenedor. 200 {status:"ok"} o 503 {status:"degraded"}.
 * Chequeo barato con el cliente ANÓNIMO (RLS lo acota, sin PII). Cachea 5 s y
 * reutiliza el cliente → una ráfaga pública no amplifica carga a la BD (4-ojos F3).
 */

const CACHE_MS = 5_000;
let cache: { payload: HealthPayload; expiresAt: number } | null = null;
let anon: SupabaseClient | null = null;

function anonClient(): SupabaseClient {
  if (!anon) {
    const env = getPublicEnv();
    anon = createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { persistSession: false } });
  }
  return anon;
}

export async function GET(): Promise<Response> {
  const now = Date.now();
  if (cache && now < cache.expiresAt) {
    return NextResponse.json(cache.payload, { status: cache.payload.status === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } });
  }

  const version = process.env.SENTRY_RELEASE ?? process.env.APP_VERSION ?? "dev";
  let db: HealthChecks["db"] = "fail";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const probe = anonClient().from("tenants").select("id").limit(1);
    const timeout = new Promise<{ error: unknown }>((resolve) => {
      timer = setTimeout(() => resolve({ error: new Error("timeout") }), 800);
      timer.unref?.();
    });
    const { error } = (await Promise.race([probe, timeout])) as { error: unknown };
    db = error ? "fail" : "ok";
  } catch {
    db = "fail";
  } finally {
    if (timer) clearTimeout(timer);
  }

  const payload = buildHealthPayload({ db }, version, new Date(now).toISOString());
  cache = { payload, expiresAt: now + CACHE_MS };
  return NextResponse.json(payload, { status: payload.status === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } });
}
