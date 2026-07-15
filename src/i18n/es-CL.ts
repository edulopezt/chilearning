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
    magicLinkTab: "Enlace por correo",
    passwordTab: "Contraseña",
    magicLinkIntro: "Te enviamos un enlace de acceso a tu correo. No necesitas contraseña.",
    magicLinkSubmit: "Enviarme el enlace",
    magicLinkSending: "Enviando…",
    magicLinkSent:
      "¡Listo! Revisa tu correo y haz clic en el enlace para entrar. Puede tardar un minuto.",
    magicLinkError: "No pudimos enviar el enlace. Revisa el correo e intenta de nuevo.",
    magicLinkExpired: "El enlace no es válido o ya expiró. Pide uno nuevo.",
  },
  dashboard: {
    title: "Panel",
    welcome: "Sesión iniciada",
    yourRoles: "Tus roles",
    yourTenant: "Tu organización",
    platformAdmin: "Administrador de plataforma (sin organización)",
    goToCourse: "Ir a mi curso",
  },
  emails: {
    title: "Correos a tus alumnos",
    intro: "Vista previa de los correos transaccionales, con la marca de tu OTEC.",
    invitationTitle: "Invitación a la plataforma",
    welcomeTitle: "Bienvenida al curso (con guía Clave Única)",
    subjectLabel: "Asunto:",
    note: "El envío real se conecta a un proveedor de correo (pendiente). Estas plantillas ya están listas y usan tu marca.",
    forbidden: "No tienes permiso para ver los correos.",
  },
  board: {
    title: "Tablero del relator",
    intro: "Avance y asistencia por acción, con semáforo de riesgo (rojo = necesita atención).",
    colCourse: "Curso",
    colCode: "Acción",
    colEnrolled: "Inscritos",
    colProgress: "Avance",
    colAttendance: "Asistencia SENCE",
    colStatus: "Estado",
    empty: "Aún no hay acciones con inscritos para mostrar.",
    forbidden: "No tienes permiso para ver el tablero.",
    green: "En marcha",
    yellow: "Atención",
    red: "En riesgo",
  },
  lessons: {
    title: "Lecciones del curso",
    intro: "Crea, ordena y publica las lecciones. Los alumnos solo ven las publicadas.",
    newLesson: "Nueva lección",
    titleLabel: "Título",
    kindLabel: "Tipo",
    kindText: "Texto",
    kindVideo: "Video (Bunny)",
    kindFile: "Archivo (PDF/enlace)",
    kindEmbed: "Contenido embebido",
    contentTextLabel: "Contenido (texto)",
    contentVideoLabel: "ID del video o URL",
    contentFileLabel: "URL del archivo (https)",
    contentEmbedLabel: "URL a embeber (https)",
    statusLabel: "Estado",
    statusDraft: "Borrador",
    statusPublished: "Publicada",
    save: "Agregar lección",
    saved: "Lección guardada.",
    empty: "Aún no hay lecciones. Crea la primera.",
    colOrder: "#",
    colTitle: "Lección",
    colKind: "Tipo",
    colStatus: "Estado",
    moveUp: "Subir",
    moveDown: "Bajar",
    publish: "Publicar",
    unpublish: "Pasar a borrador",
    remove: "Eliminar",
    forbidden: "No tienes permiso para editar las lecciones.",
    genericError: "No se pudo guardar la lección.",
  },
  branding: {
    title: "Marca de tu organización",
    intro: "Personaliza los colores, el logo y los datos legales de tu OTEC.",
    nameLabel: "Razón social",
    rutLabel: "RUT",
    logoLabel: "Logo (URL https)",
    logoHint: "Pega la URL de tu logo (por ahora; la subida de archivos llega pronto).",
    primaryLabel: "Color primario",
    accentLabel: "Color de acento",
    previewTitle: "Vista previa en vivo",
    previewCourse: "Prevención de riesgos e-learning",
    previewButton: "Ir a mi curso",
    previewBody: "Así verán tu marca los alumnos en el portal.",
    contrastOk: "Contraste AA ✓",
    contrastWarn: "Contraste bajo: el texto puede ser difícil de leer.",
    ratio: "Razón",
    applySuggestion: "Usar color sugerido",
    save: "Guardar marca",
    saved: "Marca guardada.",
    forbidden: "Solo el administrador del OTEC puede editar la marca.",
    genericError: "No se pudo guardar la marca.",
  },
  actions: {
    title: "Acciones de capacitación",
    intro: "Cada acción es una ejecución SENCE de un curso, con su código, línea y ambiente.",
    newAction: "Nueva acción",
    courseLabel: "Curso",
    codeLabel: "Código de la acción (CodigoCurso)",
    codeHint: "El código de la acción ante SENCE. En pruebas puedes usar -1 para desactivar la validación.",
    lineLabel: "Línea de capacitación",
    line1: "Línea 1 — Programas Sociales",
    line3: "Línea 3 — Franquicia Tributaria",
    line6: "Línea 6 — Formación Permanente (FPT)",
    envLabel: "Ambiente SENCE",
    envTest: "Pruebas (rcetest)",
    envProd: "Producción (rce)",
    lockLabel: "Bloquear el contenido hasta registrar asistencia",
    startsLabel: "Fecha de inicio",
    endsLabel: "Fecha de término",
    save: "Guardar acción",
    saved: "Acción guardada.",
    empty: "Aún no hay acciones. Crea la primera para poder inscribir alumnos.",
    colCourse: "Curso",
    colCode: "Código",
    colLine: "Línea",
    colEnv: "Ambiente",
    colDates: "Fechas",
    forbidden: "No tienes permiso para administrar acciones.",
    noCourses: "Primero crea un curso para poder crear acciones.",
    genericError: "No se pudo guardar la acción.",
    errorCodeWildcard: "El comodín -1 solo se permite en pruebas (rcetest).",
  },
  courses: {
    title: "Cursos",
    intro: "Crea y administra los cursos de tu OTEC.",
    newCourse: "Nuevo curso",
    nameLabel: "Nombre del curso",
    modalityLabel: "Modalidad",
    modElearning: "E-learning",
    modBlended: "Semipresencial",
    modPresential: "Presencial",
    hoursLabel: "Horas cronológicas",
    senceLabel: "Curso SENCE (franquicia)",
    codSenceLabel: "Código SENCE del curso",
    codSenceHint: "10 dígitos. Déjalo vacío si es Línea 1 (el código va en la acción).",
    statusLabel: "Estado",
    statusDraft: "Borrador",
    statusPublished: "Publicado",
    rulesTitle: "Reglas de completitud",
    requireAllLessons: "Exigir completar todas las lecciones",
    requireSurvey: "Exigir responder la encuesta",
    minAttendance: "Asistencia SENCE mínima (%)",
    save: "Guardar curso",
    saved: "Curso guardado.",
    empty: "Aún no tienes cursos. Crea el primero.",
    colName: "Curso",
    colModality: "Modalidad",
    colHours: "Horas",
    colStatus: "Estado",
    forbidden: "No tienes permiso para administrar cursos.",
    genericError: "No se pudo guardar el curso.",
  },
  enrollmentImport: {
    title: "Importar alumnos",
    intro:
      "Sube un archivo CSV con tus alumnos. Revisaremos fila por fila y solo inscribiremos las válidas.",
    actionLabel: "Acción de capacitación",
    fileLabel: "Archivo CSV",
    submit: "Revisar e importar",
    downloadTemplate: "Descargar plantilla CSV",
    templateHint:
      "Columnas: nombre, apellidos (opcional pero recomendado para los reportes SENCE), email, run, exento (Sí/No).",
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
    emailsSent: "correos de bienvenida enviados",
    emailsFailed: "correos que fallaron",
    emailsSkipped:
      "inscripciones nuevas sin correo (proveedor de correo no configurado)",
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
    openFile: "Abrir archivo",
    progressLabel: "Tu avance",
    progressOf: "de",
    lessonsWord: "lecciones",
    resume: "Retomar donde quedé",
    markComplete: "Marcar como completada",
    markIncomplete: "Marcar como pendiente",
    completed: "Completada ✓",
    courseDone: "¡Felicitaciones! Completaste todas las lecciones.",
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
