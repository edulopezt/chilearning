/**
 * Escala de notas chilena 1.0–7.0 (task 2.1, HU-6.1 — spec D-022 §S1).
 * Lineal por tramos con EXIGENCIA configurable: con `passingPct` = E,
 * obtener E% del puntaje máximo vale exactamente 4.0 (aprobación).
 * Dominio puro, sin IO.
 */

export const MIN_GRADE = 1.0;
export const MAX_GRADE = 7.0;
export const PASSING_GRADE = 4.0;

/**
 * Convierte puntaje → nota 1.0–7.0 (redondeada a 1 decimal, S1).
 * Defensivo: puntajes/exigencias fuera de rango se acotan, jamás lanza.
 */
export function chileanGrade(score: number, maxScore: number, passingPct: number): number {
  if (!Number.isFinite(maxScore) || maxScore <= 0) return MIN_GRADE;
  const p = Math.min(Math.max(Number.isFinite(score) ? score : 0, 0), maxScore);
  const e = Math.min(Math.max(Number.isFinite(passingPct) ? passingPct : 60, 1), 99) / 100;
  const cut = e * maxScore;

  const raw =
    p >= cut
      ? PASSING_GRADE + (MAX_GRADE - PASSING_GRADE) * ((p - cut) / (maxScore - cut || 1))
      : MIN_GRADE + (PASSING_GRADE - MIN_GRADE) * (p / (cut || 1));

  const rounded = Math.round(raw * 10) / 10;
  return Math.min(Math.max(rounded, MIN_GRADE), MAX_GRADE);
}

/** ¿Aprueba? (HU-4.4 / S13: umbral configurable, default 4.0). */
export function isPassing(grade: number, minGrade = PASSING_GRADE): boolean {
  return grade >= minGrade;
}
