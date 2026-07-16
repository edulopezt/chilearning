import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getPublicEnv } from "@/lib/env";
import { buildHealthPayload, type HealthChecks } from "@/lib/observability/health";

export const dynamic = "force-dynamic";

/**
 * GET /api/health (task 3.7, D-035): healthcheck público para Uptime Kuma y el
 * HEALTHCHECK del contenedor. 200 {status:"ok"} o 503 {status:"degraded"} si la
 * BD no responde. Chequeo barato con el cliente ANÓNIMO (RLS lo acota); timeout
 * corto para no colgar el monitor.
 */
export async function GET(): Promise<Response> {
  const version = process.env.SENTRY_RELEASE ?? process.env.APP_VERSION ?? "dev";
  let db: HealthChecks["db"] = "skip";
  try {
    const env = getPublicEnv();
    const anon = createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { persistSession: false } });
    const probe = anon.from("tenants").select("id").limit(1);
    const timeout = new Promise<{ error: unknown }>((resolve) => setTimeout(() => resolve({ error: new Error("timeout") }), 800));
    const { error } = (await Promise.race([probe, timeout])) as { error: unknown };
    db = error ? "fail" : "ok";
  } catch {
    db = "fail";
  }
  const payload = buildHealthPayload({ db }, version, new Date().toISOString());
  return NextResponse.json(payload, { status: payload.status === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } });
}
