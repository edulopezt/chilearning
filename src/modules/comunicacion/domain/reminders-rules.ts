import type { AutomationKind } from "./automation";

/**
 * Reglas puras de recordatorios (task 3.9). Sin IO. Deciden A QUIÉN recordar hoy
 * a partir de datos ya recolectados. El boundary (P3): error-rate (2.6) y día-1
 * (2.7) NO se duplican aquí — siguen en el worker; esto son recordatorios NUEVOS.
 */

export interface ReminderEnrollment {
  readonly enrollmentId: string;
  readonly userId: string;
  readonly exento: boolean;
  /** ¿registró asistencia SENCE hoy? (solo aplica a acciones SENCE en día de clase). */
  readonly attendedToday: boolean;
  /** Días desde la última actividad de aprendizaje; null = nunca tuvo. */
  readonly lastActivityDaysAgo: number | null;
  /** El alumno se dio de baja del canal (Ley 21.719). */
  readonly optedOut: boolean;
}

export interface ReminderTarget {
  readonly enrollmentId: string;
  readonly userId: string;
}

export const DEFAULT_INACTIVE_DAYS = 7;

/** Clave de dedup diario en la outbox: `${kind}:${userId}`. */
export function reminderKey(kind: AutomationKind, userId: string): string {
  return `${kind}:${userId}`;
}

function eligible(e: ReminderEnrollment, kind: AutomationKind, alreadySent: ReadonlySet<string>): boolean {
  return !e.optedOut && !alreadySent.has(reminderKey(kind, e.userId));
}

/** Alumnos SIN asistencia SENCE hoy (excluye exentos y opt-out y ya-recordados). */
export function selectNoAttendance(
  enrollments: readonly ReminderEnrollment[],
  alreadySent: ReadonlySet<string>,
): ReminderTarget[] {
  return enrollments
    .filter((e) => !e.exento && !e.attendedToday && eligible(e, "no_attendance", alreadySent))
    .map((e) => ({ enrollmentId: e.enrollmentId, userId: e.userId }));
}

/** Alumnos inactivos ≥ N días (o que nunca ingresaron). */
export function selectInactive(
  enrollments: readonly ReminderEnrollment[],
  thresholdDays: number,
  alreadySent: ReadonlySet<string>,
): ReminderTarget[] {
  const days = Number.isInteger(thresholdDays) && thresholdDays > 0 ? thresholdDays : DEFAULT_INACTIVE_DAYS;
  return enrollments
    .filter((e) => (e.lastActivityDaysAgo === null || e.lastActivityDaysAgo >= days) && eligible(e, "inactive", alreadySent))
    .map((e) => ({ enrollmentId: e.enrollmentId, userId: e.userId }));
}

/** Resumen para el informe al coordinador (agregado, sin PII). */
export interface CoordinatorReport {
  readonly total: number;
  readonly withoutAttendanceToday: number;
  readonly inactive: number;
}

export function coordinatorReport(enrollments: readonly ReminderEnrollment[], inactiveDays: number): CoordinatorReport {
  const days = Number.isInteger(inactiveDays) && inactiveDays > 0 ? inactiveDays : DEFAULT_INACTIVE_DAYS;
  const active = enrollments.filter((e) => !e.exento);
  return {
    total: active.length,
    withoutAttendanceToday: active.filter((e) => !e.attendedToday).length,
    inactive: active.filter((e) => e.lastActivityDaysAgo === null || e.lastActivityDaysAgo >= days).length,
  };
}
