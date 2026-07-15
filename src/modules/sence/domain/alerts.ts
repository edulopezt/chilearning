/**
 * Task 2.6 — política de alerta de tasa de error SENCE (dominio puro, sin IO).
 *
 * La tasa se calcula sobre los eventos de callback de una ventana temporal
 * (kinds `start_ok|start_error|close_ok|close_error`; los `unmatched` quedan
 * fuera: no son atribuibles a un tenant y un spike de unmatched merece una
 * alerta propia — follow-up anotado en ESTADO-PROYECTO).
 *
 * Los mensajes en español viven aquí (mismo criterio que `errors.ts`): el
 * módulo SENCE es autocontenido (I-16) y estas cadenas se persisten en la
 * tabla `alerts`, no son strings de UI.
 */

export interface ErrorRateSample {
  /** Eventos de error en la ventana (`start_error` + `close_error`). */
  readonly errors: number;
  /** Total de eventos de callback en la ventana (éxitos + errores). */
  readonly total: number;
}

export interface ErrorRatePolicy {
  /** Umbral 0..1; alerta cuando `rate >= threshold` (borde INCLUSIVO). */
  readonly threshold: number;
  /** Mínimo de eventos para que la tasa sea significativa (anti-ruido). */
  readonly minEvents: number;
}

export interface ErrorRateVerdict {
  readonly alert: boolean;
  /** Tasa observada 0..1 (0 cuando no hay eventos). */
  readonly rate: number;
}

/** Evalúa la política: alerta ⇔ `total >= minEvents` y `rate >= threshold`. */
export function evaluateErrorRate(
  sample: ErrorRateSample,
  policy: ErrorRatePolicy,
): ErrorRateVerdict {
  const rate = sample.total > 0 ? sample.errors / sample.total : 0;
  const alert = sample.total >= policy.minEvents && rate >= policy.threshold;
  return { alert, rate };
}

/** Mensaje persistido en `alerts.message` (es-CL). Sin datos personales. */
export function errorRateAlertMessage(
  verdict: ErrorRateVerdict,
  sample: ErrorRateSample,
  windowMinutes: number,
): string {
  const pct = Math.round(verdict.rate * 100);
  return (
    `Tasa de errores SENCE alta: ${pct}% (${sample.errors} de ${sample.total} ` +
    `callbacks) en los últimos ${windowMinutes} minutos. Revisa el panel de ` +
    `cumplimiento y la bitácora de eventos.`
  );
}
