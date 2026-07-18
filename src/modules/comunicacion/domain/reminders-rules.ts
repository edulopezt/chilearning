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
  /** El alumno se dio de baja del canal EMAIL (Ley 21.719). NO se usa en las
   *  reglas de selección de abajo (ver `eligible()`) — el opt-out se evalúa
   *  POR CANAL en `dispatch()` (`reminders.ts`), simétrico con `optedOutWhatsapp`,
   *  para que un opt-out de un canal jamás excluya al alumno del otro. */
  readonly optedOut: boolean;
  /** El alumno se dio de baja del canal WHATSAPP — INDEPENDIENTE de `optedOut`
   *  (`communication_opt_outs` es único por `(tenant_id, user_id, channel)`,
   *  task 5.11). Igual que `optedOut`, se evalúa en `dispatch()`, nunca aquí. */
  readonly optedOutWhatsapp: boolean;
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

// NOTA (fix task 5.11, revisión adversarial de seguridad): `eligible()` YA NO
// filtra por opt-out de ningún canal — solo dedup. Antes filtraba por
// `!e.optedOut` (email), lo que excluía de `targets` a un alumno dado de baja
// SOLO de email ANTES de que el bloque WhatsApp de `dispatch()` pudiera
// evaluar su propio opt-out independiente: el alumno se quedaba sin WhatsApp
// aunque nunca se hubiera dado de baja de ESE canal (bug real, D-049). El
// opt-out por canal se evalúa ahora en `dispatch()` para email Y WhatsApp de
// forma simétrica — la independencia entre canales es real en ambas
// direcciones, no solo en el modelo de datos.
function eligible(e: ReminderEnrollment, kind: AutomationKind, alreadySent: ReadonlySet<string>): boolean {
  return !alreadySent.has(reminderKey(kind, e.userId));
}

/** Alumnos SIN asistencia SENCE hoy (excluye exentos y ya-recordados; el
 *  opt-out por canal se filtra en `dispatch()`, no aquí — ver nota de `eligible()`). */
export function selectNoAttendance(
  enrollments: readonly ReminderEnrollment[],
  alreadySent: ReadonlySet<string>,
): ReminderTarget[] {
  return enrollments
    .filter((e) => !e.exento && !e.attendedToday && eligible(e, "no_attendance", alreadySent))
    .map((e) => ({ enrollmentId: e.enrollmentId, userId: e.userId }));
}

/** Alumnos inactivos ≥ N días (o que nunca ingresaron); el opt-out por canal
 *  se filtra en `dispatch()`, no aquí — ver nota de `eligible()`. */
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
