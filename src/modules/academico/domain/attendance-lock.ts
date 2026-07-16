/**
 * Lógica pura del candado de asistencia SENCE (I-12/I-13) — task 0.8.
 * Decide, a partir del estado de la última sesión SENCE y la exención del
 * alumno, si el contenido está desbloqueado y qué acción ofrecer.
 */

export type SenceSessionStatus =
  | "iniciada_pendiente"
  | "iniciada"
  | "cerrada"
  | "expirada"
  | "error";

export interface LockInput {
  /** El alumno está exento (becario): salta SENCE, nunca se bloquea (I-14). */
  exento: boolean;
  /** La acción exige candado de asistencia. */
  attendanceLock: boolean;
  /** Estado de la última sesión SENCE del alumno, o null si nunca registró. */
  sessionStatus: SenceSessionStatus | null;
  /** Origen del `error` (T3 `"start"` vs T7 `"close"`); relevante para ofrecer el
   *  reintento de cierre (T8, D-048/Q-05). `null`/ausente si no está en `error`. */
  errorOrigin?: "start" | "close" | null;
  /** `expires_at` de la sesión (epoch ms), si está iniciada. */
  expiresAtMs: number | null;
  /** Ahora (epoch ms). */
  nowMs: number;
}

export type LockAction = "register" | "waiting" | "close" | "none";

export interface LockState {
  /** True si el contenido del curso es visible. */
  unlocked: boolean;
  /** Acción que se ofrece al alumno. */
  action: LockAction;
  /** ms restantes de la sesión activa (para el contador), o null. */
  remainingMs: number | null;
}

export function computeLock(input: LockInput): LockState {
  // Exento o sin candado: contenido siempre visible (I-14).
  if (input.exento || !input.attendanceLock) {
    return { unlocked: true, action: "none", remainingMs: null };
  }

  switch (input.sessionStatus) {
    case "iniciada": {
      // Sesión activa: desbloqueado mientras no expire (I-13).
      const remaining = input.expiresAtMs != null ? input.expiresAtMs - input.nowMs : null;
      if (remaining != null && remaining <= 0) {
        // Expiró de facto (aunque el worker aún no la marque): re-bloquear.
        return { unlocked: false, action: "register", remainingMs: null };
      }
      return { unlocked: true, action: "close", remainingMs: remaining };
    }
    case "iniciada_pendiente":
      // Registrando: esperando el retorno desde Clave Única.
      return { unlocked: false, action: "waiting", remainingMs: null };
    case "error":
      // Un cierre CON ERROR (T7, `error(close)`) puede REINTENTARSE (T8,
      // D-048/Q-05) con el mismo IdSesionSence, así la sesión no queda colgada ante
      // SENCE — PERO solo mientras no se supere `expires_at` (T8 está gateado). Si ya
      // venció (el worker la expirará por T9), el reintento sería fútil → re-registrar.
      // Un error de INICIO (T3, `error(start)`) es terminal → (re)registrar desde cero.
      if (input.errorOrigin === "close") {
        const expired = input.expiresAtMs !== null && input.nowMs >= input.expiresAtMs;
        if (!expired) {
          return { unlocked: false, action: "close", remainingMs: null };
        }
      }
      return { unlocked: false, action: "register", remainingMs: null };
    case "cerrada":
    case "expirada":
    case null:
      // Debe (re)registrar su asistencia para desbloquear.
      return { unlocked: false, action: "register", remainingMs: null };
  }
}
