/**
 * Semáforo de avance de una acción para el tablero del relator (task 1.8,
 * HU-3.4). Puro, sin IO. Combina el avance promedio del contenido con la tasa
 * de asistencia SENCE registrada; el color refleja el riesgo de la acción.
 */

export type SemaforoColor = "green" | "yellow" | "red";

export interface ActionMetrics {
  enrolled: number;
  /** Avance de contenido promedio (0..100). */
  avgProgressPct: number;
  /** % de inscritos con asistencia SENCE registrada (0..100). */
  attendanceRatePct: number;
  /** La acción exige asistencia SENCE (candado). Si no, el semáforo la ignora. */
  requiresAttendance: boolean;
}

export interface Semaforo {
  color: SemaforoColor;
  /** Puntaje 0..100 que resume el estado (para ordenar). */
  score: number;
}

/**
 * Verde: la acción va bien encaminada. Rojo: en riesgo (poco avance o poca
 * asistencia). Amarillo: intermedio. Sin inscritos → rojo (nada ocurriendo).
 * Para acciones con candado, el puntaje pondera avance y asistencia por igual;
 * sin candado, solo el avance.
 */
export function semaforo(m: ActionMetrics): Semaforo {
  if (m.enrolled === 0) return { color: "red", score: 0 };

  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const progress = clamp(m.avgProgressPct);
  const attendance = clamp(m.attendanceRatePct);

  const score = m.requiresAttendance ? Math.round((progress + attendance) / 2) : Math.round(progress);

  const color: SemaforoColor = score >= 67 ? "green" : score >= 34 ? "yellow" : "red";
  return { color, score };
}
