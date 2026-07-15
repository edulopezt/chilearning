/**
 * Dominio puro de elegibilidad del certificado (task 3.2, HU-7.1). Evalúa las
 * reglas de completitud del curso contra los hechos del alumno. Deny-by-default:
 * cualquier requisito no cumplido devuelve un motivo y bloquea la emisión. Sin IO.
 */

export const PASSING_GRADE = 4.0;

export interface EligibilityRules {
  readonly requireAllLessons: boolean;
  readonly requireSurvey: boolean;
  /** Nota mínima (escala 1–7). Solo aplica si el alumno TIENE nota. */
  readonly minGrade: number;
  /** Umbral de asistencia SENCE 0–100 (0 = sin gate). */
  readonly minAttendancePct: number;
  /** Curso SENCE: si no lo es, no hay gate de asistencia. */
  readonly isSence: boolean;
}

export interface CompletionFacts {
  readonly allLessonsDone: boolean;
  /** Nota final consolidada (null = sin instrumentos calificados). */
  readonly finalGrade: number | null;
  readonly surveyDone: boolean;
  /** % de asistencia SENCE registrada (0–100). */
  readonly attendancePct: number;
  /** Alumno exento de SENCE (no registra asistencia → no aplica el gate). */
  readonly exento: boolean;
}

export type EligibilityReason =
  | "lessons_incomplete"
  | "grade_below_min"
  | "survey_pending"
  | "attendance_below_min";

export interface EligibilityResult {
  readonly eligible: boolean;
  readonly reasons: readonly EligibilityReason[];
}

export function evaluateEligibility(
  rules: EligibilityRules,
  facts: CompletionFacts,
): EligibilityResult {
  const reasons: EligibilityReason[] = [];

  if (rules.requireAllLessons && !facts.allLessonsDone) {
    reasons.push("lessons_incomplete");
  }
  // La nota solo bloquea si EXISTE y reprueba: un curso sin instrumentos
  // calificados (asistencia pura) no exige nota.
  if (facts.finalGrade !== null && facts.finalGrade < rules.minGrade) {
    reasons.push("grade_below_min");
  }
  if (rules.requireSurvey && !facts.surveyDone) {
    reasons.push("survey_pending");
  }
  // Gate de asistencia: solo cursos SENCE, alumnos NO exentos, umbral > 0.
  if (rules.isSence && !facts.exento && rules.minAttendancePct > 0 && facts.attendancePct < rules.minAttendancePct) {
    reasons.push("attendance_below_min");
  }

  return { eligible: reasons.length === 0, reasons };
}
