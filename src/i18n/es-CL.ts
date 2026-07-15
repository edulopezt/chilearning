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
  auth: {
    loginTitle: "Ingresar a Chilearning",
    emailLabel: "Correo electrónico",
    passwordLabel: "Contraseña",
    submit: "Ingresar",
    signingIn: "Ingresando…",
    signOut: "Cerrar sesión",
    invalidCredentials: "Correo o contraseña incorrectos.",
    genericError: "No pudimos iniciar sesión. Intenta nuevamente.",
    noAccess:
      "Tu cuenta no tiene acceso a ninguna organización. Contacta a tu administrador.",
  },
  dashboard: {
    title: "Panel",
    welcome: "Sesión iniciada",
    yourRoles: "Tus roles",
    yourTenant: "Tu organización",
    platformAdmin: "Administrador de plataforma (sin organización)",
    goToCourse: "Ir a mi curso",
  },
  enrollmentImport: {
    title: "Importar alumnos",
    intro:
      "Sube un archivo CSV con tus alumnos. Revisaremos fila por fila y solo inscribiremos las válidas.",
    actionLabel: "Acción de capacitación",
    fileLabel: "Archivo CSV",
    submit: "Revisar e importar",
    downloadTemplate: "Descargar plantilla CSV",
    templateHint: "Columnas: nombre, email, run, exento (Sí/No).",
    noActions: "Primero crea una acción de capacitación para poder inscribir alumnos.",
    forbidden: "No tienes permiso para importar alumnos.",
    resultTitle: "Resultado del import",
    imported: "inscritos",
    rejected: "filas rechazadas",
    failed: "filas con error al inscribir",
    rowColumn: "Fila",
    fieldColumn: "Campo",
    messageColumn: "Problema",
    allGood: "Todas las filas eran válidas. ¡Listo!",
    errorNoFile: "Debes seleccionar un archivo CSV.",
    errorNoAction: "Debes seleccionar una acción.",
  },
  senceAdmin: {
    title: "Configuración SENCE",
    intro:
      "Configura las credenciales SENCE de tu OTEC. El token se guarda cifrado y nunca se vuelve a mostrar.",
    rutLabel: "RUT del OTEC",
    rutHint: "Formato: 76111111-6 (con dígito verificador).",
    environmentLabel: "Ambiente",
    envTest: "Pruebas (rcetest)",
    envProd: "Producción (rce)",
    tokenLabel: "Token SENCE",
    tokenHintNew: "Pega el token generado en sistemas.sence.cl/rts.",
    tokenHintConfigured:
      "Ya hay un token configurado. Déjalo vacío para conservarlo, o pega uno nuevo para reemplazarlo.",
    tokenConfigured: "Token configurado ✓",
    tokenMissing: "Sin token configurado",
    save: "Guardar configuración",
    saved: "Configuración guardada.",
    errorRut: "El RUT del OTEC no es válido (revisa el dígito verificador).",
    errorToken: "El token debe tener 36 caracteres.",
    errorForbidden: "No tienes permiso para configurar SENCE.",
    forbidden: "Solo el administrador del OTEC puede acceder a esta página.",
  },
  course: {
    noCourse: "Aún no tienes cursos asignados.",
    lockedTitle: "Registra tu asistencia SENCE para acceder al contenido",
    lockedBody:
      "Para ver este curso debes registrar tu asistencia con tu Clave Única, según exige SENCE.",
    register: "Registrar asistencia SENCE",
    registering: "Registrando… vuelve a esta página tras iniciar sesión con tu Clave Única.",
    waiting: "Estamos esperando la confirmación de SENCE. Recarga en unos segundos.",
    close: "Cerrar sesión SENCE",
    exento: "Estás exento(a) de registro SENCE (becario/a). Puedes ver el contenido directamente.",
    sessionActive: "Asistencia registrada. Tu sesión SENCE está activa.",
    timeLeft: "Tiempo restante de sesión",
    expired: "Tu sesión SENCE expiró. Vuelve a registrar tu asistencia para continuar.",
    lessonsTitle: "Contenido del curso",
    videoNote: "Video de la lección",
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
