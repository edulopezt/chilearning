/**
 * Task 2.6 — parseo de la configuración operativa del motor/worker SENCE
 * (I-13, D-003): puro y defensivo. Un valor ausente o inválido cae al default
 * documentado en el contrato (3 h / 60 min) sin lanzar: el worker jamás debe
 * morir por una env mal escrita (el default es seguro; el valor raro se
 * reporta en el resultado para que el llamador lo loguee).
 *
 * Lo consumen `env.server.ts` (lado Next: `sessionMaxMs` del motor) y el
 * worker (`src/worker/index.ts`), leyendo cada uno su propio `env`.
 */

export interface SenceTiming {
  /** T4: deadline de abandono de Clave Única (ms). */
  readonly pendingTimeoutMs: number;
  /** T2 ancla `expires_at = recepción + sessionMaxMs` (ms). */
  readonly sessionMaxMs: number;
  /** Ventana de la tasa de error (ms). */
  readonly alertWindowMs: number;
  /** Umbral de la tasa de error, 0..1 (borde inclusivo). */
  readonly alertErrorRateThreshold: number;
  /** Mínimo de eventos en la ventana para evaluar la tasa. */
  readonly alertMinEvents: number;
  /** Frecuencia del job repetible del worker (ms). */
  readonly tickEveryMs: number;
  /** Día-1 (task 2.7): umbral de asistencia 0..1 (alerta si ratio < umbral). */
  readonly day1AttendanceThreshold: number;
  /** Día-1: hora local (America/Santiago) desde la que se evalúa, 1-23. */
  readonly day1EvalHour: number;
  /** Claves de env cuyo valor era inválido y cayó al default. */
  readonly invalidKeys: readonly string[];
}

export const SENCE_TIMING_DEFAULTS = {
  pendingTimeoutMinutes: 60,
  sessionMaxHours: 3,
  alertWindowMinutes: 60,
  alertErrorRateThreshold: 0.2,
  alertMinEvents: 5,
  tickEveryMs: 5 * 60_000,
  day1AttendanceThreshold: 0.5,
  day1EvalHour: 13,
} as const;

function parsePositiveInt(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

function parseRatio(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) return null;
  return value;
}

/** Lee los knobs desde un env plano (inyectable: `process.env` o un fixture). */
export function senceTimingFromEnv(env: Record<string, string | undefined>): SenceTiming {
  const invalidKeys: string[] = [];
  const int = (key: string, fallback: number): number => {
    const parsed = parsePositiveInt(env[key], fallback);
    if (parsed === null) {
      invalidKeys.push(key);
      return fallback;
    }
    return parsed;
  };
  const ratio = (key: string, fallback: number): number => {
    const parsed = parseRatio(env[key], fallback);
    if (parsed === null) {
      invalidKeys.push(key);
      return fallback;
    }
    return parsed;
  };

  /** Entero 1-23 (hora local del día). Fuera de rango → default + reporte. */
  const hourOfDay = (key: string, fallback: number): number => {
    const parsed = parsePositiveInt(env[key], fallback);
    if (parsed === null || parsed > 23) {
      invalidKeys.push(key);
      return fallback;
    }
    return parsed;
  };

  const d = SENCE_TIMING_DEFAULTS;
  return {
    pendingTimeoutMs: int("SENCE_PENDING_TIMEOUT_MINUTES", d.pendingTimeoutMinutes) * 60_000,
    sessionMaxMs: int("SENCE_SESSION_MAX_HOURS", d.sessionMaxHours) * 3_600_000,
    alertWindowMs: int("SENCE_ALERT_WINDOW_MINUTES", d.alertWindowMinutes) * 60_000,
    alertErrorRateThreshold: ratio("SENCE_ALERT_ERROR_RATE_THRESHOLD", d.alertErrorRateThreshold),
    alertMinEvents: int("SENCE_ALERT_MIN_EVENTS", d.alertMinEvents),
    // Revisión R-3: era el único knob sin defensa; un negativo llegaba crudo a
    // BullMQ (upsertJobScheduler no valida `every`) y rompía el scheduling.
    tickEveryMs: int("SENCE_TICK_EVERY_MS", d.tickEveryMs),
    day1AttendanceThreshold: ratio("SENCE_DAY1_ATTENDANCE_THRESHOLD", d.day1AttendanceThreshold),
    day1EvalHour: hourOfDay("SENCE_DAY1_EVAL_HOUR", d.day1EvalHour),
    invalidKeys,
  };
}
