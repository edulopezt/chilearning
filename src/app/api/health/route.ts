import { NextResponse } from "next/server";

import { probeDb } from "@/lib/observability/db-probe";
import { buildHealthPayload, type HealthChecks, type HealthPayload } from "@/lib/observability/health";

export const dynamic = "force-dynamic";

/**
 * GET /api/health (task 3.7, D-035): healthcheck público para Uptime Kuma y el
 * HEALTHCHECK del contenedor. 200 {status:"ok"} o 503 {status:"degraded"}.
 * Chequeo barato con el cliente ANÓNIMO (RLS lo acota, sin PII). Cachea 5 s y
 * reutiliza el cliente → una ráfaga pública no amplifica carga a la BD (4-ojos F3).
 *
 * La sonda vive en `@/lib/observability/db-probe` desde la task 5.5: el tablero
 * superadmin (HU-10.3) reporta la MISMA salud sin duplicar lógica. El contrato de
 * este endpoint (payload, códigos, caché de 5 s) no cambia; sí se CORRIGIÓ la
 * sonda, que devolvía 503 siempre — ver la nota en db-probe.ts.
 */

const CACHE_MS = 5_000;
let cache: { payload: HealthPayload; expiresAt: number } | null = null;

export async function GET(): Promise<Response> {
  const now = Date.now();
  if (cache && now < cache.expiresAt) {
    return NextResponse.json(cache.payload, { status: cache.payload.status === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } });
  }

  const version = process.env.SENTRY_RELEASE ?? process.env.APP_VERSION ?? "dev";
  const db: HealthChecks["db"] = await probeDb();

  const payload = buildHealthPayload({ db }, version, new Date(now).toISOString());
  cache = { payload, expiresAt: now + CACHE_MS };
  return NextResponse.json(payload, { status: payload.status === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } });
}
