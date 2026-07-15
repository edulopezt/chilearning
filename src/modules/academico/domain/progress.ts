/**
 * Cálculo de progreso del alumno (task 1.5, HU-4.3). Puro, sin IO.
 */

export interface ProgressSummary {
  total: number;
  completed: number;
  /** Porcentaje 0..100 (entero). 100 si no hay lecciones (nada pendiente). */
  percent: number;
  /** id de la lección para "retomar": la primera no completada, o null si todo listo. */
  resumeLessonId: string | null;
  done: boolean;
}

/**
 * Resume el avance dadas las lecciones ordenadas del curso y el conjunto de
 * ids completados. "Retomar" apunta a la primera lección (en orden) que aún no
 * se completa.
 */
export function summarizeProgress(
  lessons: readonly { id: string }[],
  completedIds: ReadonlySet<string>,
): ProgressSummary {
  const total = lessons.length;
  const completed = lessons.filter((l) => completedIds.has(l.id)).length;
  const resume = lessons.find((l) => !completedIds.has(l.id))?.id ?? null;
  const percent = total === 0 ? 100 : Math.round((completed / total) * 100);
  return { total, completed, percent, resumeLessonId: resume, done: total > 0 && completed === total };
}
