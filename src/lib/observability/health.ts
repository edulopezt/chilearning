/**
 * Payload del healthcheck (task 3.7, D-035). Puro: deriva el estado del resultado
 * de los chequeos. Lo consume `/api/health` (Uptime Kuma).
 */

export interface HealthChecks {
  readonly db: "ok" | "fail" | "skip";
}

export interface HealthPayload {
  readonly status: "ok" | "degraded";
  readonly checks: HealthChecks;
  readonly version: string;
  readonly time: string;
}

export function buildHealthPayload(checks: HealthChecks, version: string, timeISO: string): HealthPayload {
  const status = checks.db === "fail" ? "degraded" : "ok";
  return { status, checks, version, time: timeISO };
}

/**
 * Versión del despliegue. Vive aquí junto al resto del payload de salud para que
 * `/api/health` y el tablero superadmin reporten SIEMPRE la misma cadena: eran
 * dos copias literales de la misma expresión, y sumar un origen nuevo a una sola
 * habría hecho divergir a los dos llamadores sobre el mismo despliegue.
 */
export function appVersion(): string {
  return process.env.SENTRY_RELEASE ?? process.env.APP_VERSION ?? "dev";
}
