/**
 * Textos de UI en español de Chile — fuente ÚNICA de strings visibles.
 * Prohibido poner strings sueltos en componentes (CLAUDE.md §Estilo).
 */
export const esCL = {
  common: {
    appName: "Chilearning",
  },
  landing: {
    title: "Chilearning",
    tagline:
      "La plataforma e-learning para OTECs chilenas, con asistencia SENCE integrada.",
    status: "Plataforma en construcción — Hito 0: fundación.",
  },
  sence: {
    /**
     * Mensajes para el alumno ante un error del protocolo RCE.
     * Fuente: contrato del motor (src/modules/sence/README.md §5), columna
     * "Mensaje es-CL para el alumno". Los mapea `src/modules/sence/errors.ts`.
     *
     * REGLA (I-9): al alumno JAMÁS se le muestra el código crudo, la glosa oficial
     * ni texto técnico. Estos mensajes no contienen números de código a propósito.
     */
    errors: {
      /** Fallback obligatorio (I-9): código desconocido, deprecated o GlosaError ilegible. */
      fallback:
        "No pudimos registrar tu asistencia en SENCE. Intenta nuevamente; si el problema continúa, avisa a tu OTEC.",
      /** 200, 201, 202, 203, 209 — bug/config nuestra: el alumno no puede hacer nada. */
      technicalIssue:
        "Hubo un problema técnico al conectar con SENCE. Ya avisamos al equipo; intenta más tarde.",
      /** 204, 205, 206, 306, 308 — la acción/curso está mal configurada ante SENCE. */
      courseMisconfigured:
        "El curso tiene un problema de configuración con SENCE. Avisa al administrador de tu curso.",
      /** 207 — el RUN del alumno en la plataforma es inválido. */
      invalidStudentRun:
        "Tu RUN registrado en la plataforma parece incorrecto. Pide a tu OTEC que lo corrija antes de reintentar.",
      /** 208 — el RUN no está en la nómina comunicada a SENCE. */
      studentNotEnrolled:
        "Tu RUN no aparece inscrito ante SENCE para este curso. Contacta a tu OTEC para verificar tu inscripción.",
      /** 211, 212, 303 — problema con el token del OTEC (nunca se nombra el token). */
      tokenIssue:
        "No pudimos validar la conexión con SENCE. Avisa al administrador de tu curso e intenta más tarde.",
      /** 300, 304, 305 — falla temporal del lado de SENCE. */
      senceTemporaryIssue:
        "SENCE presentó un problema temporal. Intenta nuevamente en unos minutos.",
      /** 301 — SENCE no pudo registrar el ingreso/cierre de sesión. */
      sessionNotRegistered:
        "No se pudo registrar tu sesión en SENCE. Avisa al administrador de tu curso.",
      /** 302 — SENCE no pudo validar los datos del organismo. */
      organismValidationIssue:
        "SENCE presentó un problema al validar los datos del organismo. Intenta más tarde.",
      /** 307 — la acción no está comunicada como e-learning. */
      courseNotElearning:
        "Este curso no está habilitado como e-learning ante SENCE. Avisa al administrador de tu curso.",
      /** 309 — fuera del período de ejecución comunicado. */
      courseOutsideExecutionDates:
        "El curso no está en su período de ejecución ante SENCE, por lo que hoy no se puede registrar asistencia. Consulta a tu OTEC.",
      /** 310 — acción terminada o anulada. */
      courseFinishedOrCancelled:
        "Este curso figura terminado o anulado ante SENCE. Consulta a tu OTEC.",
      /** 311 — el RUN de Clave Única no es el del alumno inscrito. */
      claveUnicaRunMismatch:
        "Iniciaste sesión en Clave Única con un RUN distinto al tuyo inscrito en el curso. Ingresa con TU propia Clave Única e intenta de nuevo.",
      /** 312 — falló la autenticación con Clave Única. */
      claveUnicaAuthFailed:
        "No pudimos validar tu identidad con Clave Única. Intenta nuevamente; si el problema continúa, recupera tu Clave Única en claveunica.gob.cl.",
      /** 313 — error al cerrar la sesión SENCE. */
      sessionCloseFailed:
        "Hubo un problema técnico al cerrar tu sesión SENCE. Ya avisamos al equipo; intenta cerrar nuevamente.",
    },
  },
} as const;

export type Messages = typeof esCL;
