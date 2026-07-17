/**
 * Extracción PURA (sin IO) de señales de progreso/nota desde el estado CMI que
 * reporta el SCO vía scorm-again (task 5.1b, HU-4.2, ADR-006). El objeto `cmi`
 * llega tal cual lo produce `api.renderCMIToJSONObject()` (sin el prefijo
 * "cmi." y sin envoltorio "cmi": las claves top-level son directamente
 * `core`/`completion_status`/etc., como documenta el README de scorm-again en
 * la sección "Initial Values"/`loadFromJSON`).
 *
 * Es la ÚNICA vía por la que el reproductor deriva `lesson_progress` — nunca
 * confía en que el SCO "diga la verdad" sin normalizar: el paquete lo autora
 * un tercero (Storyline, Rise, etc.), así que esta función es TOLERANTE por
 * diseño: cualquier estructura parcial, ausente o directamente basura resuelve
 * a los valores por defecto en vez de lanzar. Un paquete SCORM mal formado no
 * debe poder tumbar el endpoint de persistencia CMI.
 */

/** Espeja el CHECK `pg_column_size(data) <= 262144` de la migración `scorm_cmi`. */
export const MAX_CMI_BYTES = 262144;

export type ScormVersion = "1.2" | "2004";

export interface CmiSignals {
  /** El intento se considera terminado con éxito (marca `lesson_progress`). */
  readonly completed: boolean;
  /** Nota (0–100 típicamente), o null si no se pudo determinar. */
  readonly scoreRaw: number | null;
  /** Estado normalizado para mostrar en el panel de resultados del staff. */
  readonly lessonStatus: string | null;
}

const EMPTY_SIGNALS: CmiSignals = { completed: false, scoreRaw: null, lessonStatus: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `Number(...)` tolerante: nunca NaN/Infinity, acepta number o string numérica. */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractScorm12(cmi: Record<string, unknown>): CmiSignals {
  const core = isRecord(cmi.core) ? cmi.core : {};
  const lessonStatus = typeof core.lesson_status === "string" ? core.lesson_status : null;
  const completed = lessonStatus === "completed" || lessonStatus === "passed";
  const score = isRecord(core.score) ? core.score : {};
  const scoreRaw = toFiniteNumber(score.raw);
  return { completed, scoreRaw, lessonStatus };
}

function extractScorm2004(cmi: Record<string, unknown>): CmiSignals {
  const completionStatus = typeof cmi.completion_status === "string" ? cmi.completion_status : null;
  const successStatus = typeof cmi.success_status === "string" ? cmi.success_status : null;
  const completed = completionStatus === "completed" || successStatus === "passed";

  const score = isRecord(cmi.score) ? cmi.score : {};
  let scoreRaw = toFiniteNumber(score.raw);
  if (scoreRaw === null) {
    // Fallback: SCORM 2004 permite reportar solo `score.scaled` (0..1) sin
    // `score.raw`. Se normaliza a la misma escala 0–100 que usa 1.2, para que
    // el panel de resultados del staff muestre un número comparable.
    const scaled = toFiniteNumber(score.scaled);
    if (scaled !== null && scaled >= 0 && scaled <= 1) {
      scoreRaw = Math.round(scaled * 100);
    }
  }

  // `lesson_status` no existe en 2004: se normaliza a un análogo legible para
  // el panel de resultados, priorizando `success_status` (más decisivo sobre
  // si el intento fue pass/fail) y cayendo a `completion_status` si no hay
  // veredicto de éxito.
  let lessonStatus: string | null = null;
  if (successStatus === "passed" || successStatus === "failed") {
    lessonStatus = successStatus;
  } else if (completionStatus) {
    lessonStatus = completionStatus;
  }

  return { completed, scoreRaw, lessonStatus };
}

/**
 * Deriva {completed, scoreRaw, lessonStatus} del estado CMI reportado por el
 * SCO. NUNCA lanza: `cmi` es input no confiable (lo produce un paquete de
 * autor de terceros vía `scorm-again` en el navegador del alumno).
 */
export function extractCmiSignals(version: ScormVersion, cmi: unknown): CmiSignals {
  if (!isRecord(cmi)) return EMPTY_SIGNALS;
  return version === "1.2" ? extractScorm12(cmi) : extractScorm2004(cmi);
}
