import { NextResponse } from "next/server";

import { probeDb } from "@/lib/observability/db-probe";
import { appVersion, buildHealthPayload, type HealthChecks, type HealthPayload } from "@/lib/observability/health";

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
 * sonda, que dependía de un GRANT que solo existe por drift del cloud (daba 503
 * en local/CI con la BD sana) — ver la nota en db-probe.ts.
 */

const CACHE_MS = 5_000;
let cache: { payload: HealthPayload; expiresAt: number } | null = null;

export async function GET(): Promise<Response> {
  const now = Date.now();
  if (cache && now < cache.expiresAt) {
    return NextResponse.json(cache.payload, { status: cache.payload.status === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } });
  }

  const db: HealthChecks["db"] = await probeDb();

  const payload = buildHealthPayload({ db }, appVersion(), new Date(now).toISOString());
  cache = { payload, expiresAt: now + CACHE_MS };
  return NextResponse.json(payload, { status: payload.status === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } });
}
