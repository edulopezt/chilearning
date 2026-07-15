/**
 * Task 2.7 (HU-5.8) — alerta temprana del DÍA 1: si en el primer día de la
 * acción la asistencia SENCE registrada está bajo el umbral, se alerta al
 * coordinador ANTES de que el día se pierda (el peor descubrimiento posible es
 * "nadie registró asistencia" una semana después, con la franquicia en juego).
 *
 * Dominio puro; el IO (qué acciones parten hoy, cuántos registraron) vive en
 * el tick del worker (`expiry.ts`), que corre igual aunque nadie abra el panel.
 */

export interface Day1Sample {
  /** Inscritos NO exentos de la acción (los exentos no registran SENCE, I-14). */
  readonly enrolledNonExempt: number;
  /** Inscritos con al menos una sesión `iniciada` o `cerrada` HOY. */
  readonly withSessionToday: number;
}

export interface Day1Verdict {
  readonly alert: boolean;
  /** Proporción 0..1 (1 cuando no hay inscritos no exentos: nada que alertar). */
  readonly ratio: number;
}

/** Alerta ⇔ hay inscritos no exentos y `ratio < threshold` (borde EXCLUSIVO:
 *  llegar exactamente al umbral configurado se considera aceptable). */
export function evaluateDay1(sample: Day1Sample, threshold: number): Day1Verdict {
  if (sample.enrolledNonExempt <= 0) return { alert: false, ratio: 1 };
  const ratio = sample.withSessionToday / sample.enrolledNonExempt;
  return { alert: ratio < threshold, ratio };
}

/** Mensaje persistido en `alerts.message` (es-CL). Sin datos personales. */
export function day1AlertMessage(
  verdict: Day1Verdict,
  sample: Day1Sample,
  codigoAccion: string,
): string {
  const pct = Math.round(verdict.ratio * 100);
  return (
    `Asistencia baja en el día 1 de la acción ${codigoAccion}: solo ` +
    `${sample.withSessionToday} de ${sample.enrolledNonExempt} alumnos ` +
    `(${pct}%) han registrado asistencia SENCE hoy. Contacta a los alumnos ` +
    `y reenvíales la guía de Clave Única.`
  );
}

/** Fecha local YYYY-MM-DD en una zona horaria (sin dependencias). */
export function localIsoDate(epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochMs));
}

/** Hora local 0-23 en una zona horaria. */
export function localHour(epochMs: number, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hour12: false,
    }).format(new Date(epochMs)),
  );
}
