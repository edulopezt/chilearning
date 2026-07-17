/**
 * Texto legal del BORRADOR de política de privacidad (task 5.6, Ley 21.719).
 *
 * ⚠ EXCEPCIÓN DELIBERADA a la regla de i18n de CLAUDE.md ("todo texto visible
 * vive en src/i18n/es-CL.ts"): esto NO son strings de UI de producto, es un
 * DOCUMENTO legal. Vive acá porque (a) se revisa y versiona como un documento
 * completo —un abogado lo lee de corrido, no en un árbol de claves—, (b) nunca
 * se traducirá (aplica a Chile) y (c) mezclarlo con la UI ensuciaría `esCL`
 * con párrafos de varias líneas. Los RÓTULOS de la página (títulos de sección
 * de la UI, botones, banner) sí están en `esCL.privacyPolicy`.
 *
 * ⚠ BORRADOR: pendiente de revisión de un abogado antes del lanzamiento
 * comercial (spec §9, riesgo S2). Los plazos de retención vienen del catálogo
 * en código (`src/modules/core/domain/privacy.ts`), que ya está FLAGGED para
 * esa misma revisión (D-033).
 */

import {
  CURRENT_PRIVACY_POLICY_VERSION,
  PROCESSING_ACTIVITIES,
  RETENTION_POLICIES,
} from "@/modules/core/domain/privacy";

/**
 * La versión del documento es la MISMA constante que firma el alumno al dar su
 * consentimiento: si una cambia sin la otra, el consentimiento registrado
 * apuntaría a un texto que nadie puede leer.
 */
export const POLICY_VERSION = CURRENT_PRIVACY_POLICY_VERSION;
export const POLICY_UPDATED = "17 de julio de 2026";

/** Reexport para que la página no tenga que conocer el módulo de dominio. */
export { PROCESSING_ACTIVITIES, RETENTION_POLICIES };

/**
 * ⚠ PENDIENTE DE EDU: la identidad legal del prestador no está definida en
 * ningún documento del repo. Sin razón social, RUT y domicilio, la política no
 * puede publicarse como vigente (la Ley 21.719 exige identificar al
 * responsable/encargado).
 */
export const LEGAL_ENTITY = {
  tradeName: "Chilearning",
  legalName: "[RAZÓN SOCIAL — POR DEFINIR]",
  taxId: "[RUT — POR DEFINIR]",
  address: "[DOMICILIO — POR DEFINIR]",
  contactEmail: "[CORREO DE CONTACTO — POR CONFIRMAR]",
} as const;

export interface PolicySection {
  readonly id: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

export const POLICY_SECTIONS: readonly PolicySection[] = [
  {
    id: "roles",
    heading: "1. Quién es responsable de tus datos",
    paragraphs: [
      "La Ley 21.719 distingue dos papeles. El RESPONSABLE decide para qué se tratan los datos; el ENCARGADO los trata siguiendo las instrucciones del responsable.",
      "Cuando eres alumno(a), trabajador(a) de una empresa capacitada o parte del equipo de una OTEC, el RESPONSABLE de tus datos es la OTEC que te inscribió en el curso, no Chilearning. La OTEC decide qué cursos dicta, a quién inscribe y qué informa a SENCE.",
      "Chilearning actúa como ENCARGADO: proveemos la plataforma y tratamos esos datos únicamente siguiendo las instrucciones documentadas de la OTEC, en los términos del contrato de encargo de tratamiento que cada OTEC firma con nosotros. No usamos los datos de los alumnos para fines propios, no los vendemos y no los cedemos a terceros fuera de lo descrito en este documento.",
      "Hay un caso en que sí somos RESPONSABLES: los datos de quienes nos escriben por el correo de contacto comercial de este sitio, y los datos de la propia cuenta de la OTEC como cliente. Ese tratamiento se limita a responder la consulta y administrar la relación comercial.",
      "Si eres alumno(a) y quieres ejercer tus derechos, puedes hacerlo directamente en la plataforma (ver la sección de derechos) o dirigirte a tu OTEC. Si nos llega una solicitud tuya y el responsable es tu OTEC, la derivamos a ella sin demora.",
    ],
  },
  {
    id: "datos",
    heading: "2. Qué datos tratamos",
    paragraphs: [
      "Aplicamos minimización: pedimos y guardamos solo lo necesario para operar el curso y cumplir con SENCE.",
      "• Identificación: nombre, apellidos y correo electrónico.",
      "• RUN (Rol Único Nacional): se trata porque el registro de asistencia del RCE de SENCE lo exige para validar la franquicia tributaria. No se pide para otros fines. En la verificación pública de certificados el RUN se muestra ENMASCARADO, nunca completo.",
      "• Datos del curso: progreso por lección, respuestas de evaluaciones, calificaciones, entregas de tareas y certificados emitidos.",
      "• Asistencia SENCE: sesiones iniciadas y cerradas ante el RCE, con sus marcas de tiempo y los eventos del protocolo.",
      "• Comunicación: mensajes, publicaciones en foros y avisos del curso.",
      "• Datos técnicos y de seguridad: identificador de usuario, dirección IP y registros de auditoría de acciones sensibles.",
      "• Encuestas de satisfacción: se responden de forma anónima y se muestran solo agregadas; por construcción no quedan asociadas a tu identidad.",
      "No tratamos datos sensibles (salud, afiliación sindical, biometría) ni perfilamos automáticamente a los alumnos para tomar decisiones que les produzcan efectos jurídicos.",
    ],
  },
  {
    id: "finalidades",
    heading: "3. Para qué los tratamos y con qué base de licitud",
    paragraphs: [
      "El registro de tratamientos de la plataforma es el siguiente. Es el mismo que cada usuario puede consultar dentro de su cuenta:",
    ],
  },
  {
    id: "encargados",
    heading: "4. Con quién se comparten (destinatarios y subencargados)",
    paragraphs: [
      "SENCE: la asistencia y los datos que el Estatuto de Capacitación exige se transmiten al Servicio Nacional de Capacitación y Empleo a través del RCE. Es una obligación legal de la OTEC y la razón de ser de la plataforma.",
      "Empresa capacitada y OTIC: cuando el curso se financia con franquicia tributaria, la empresa que capacita y su OTIC pueden acceder al avance y la asistencia de sus trabajadores, según el alcance que la OTEC configure.",
      "Fiscalizadores y auditores: SENCE, la OTIC o un auditor pueden recibir un acceso de solo lectura, acotado a un alcance y una vigencia definidos por la OTEC. Cada consulta que hacen queda auditada.",
      "Proveedores que nos prestan servicios (subencargados): trabajan bajo contrato, solo con nuestras instrucciones y sin usar los datos para fines propios. La lista vigente está en la tabla siguiente y se mantiene actualizada en el contrato de encargo.",
      "No vendemos datos personales ni los usamos para publicidad.",
    ],
  },
  {
    id: "transferencia",
    heading: "5. Transferencia internacional de datos",
    paragraphs: [
      "⚠ Importante y explícito: la base de datos de la plataforma está alojada en la región de São Paulo, Brasil (Supabase). Esto significa que tus datos personales —incluido el RUN— se almacenan fuera de Chile.",
      "Otros proveedores (correo, video, monitoreo de errores, respaldos) también operan infraestructura fuera de Chile.",
      "Nos apoyamos en salvaguardas contractuales con cada proveedor y aplicamos medidas técnicas adicionales: cifrado en tránsito, cifrado en reposo, cifrado a nivel de aplicación para los secretos más sensibles (como el token SENCE de la OTEC) y respaldos cifrados con clave que solo controlamos nosotros.",
      "Este punto está identificado como un riesgo abierto del proyecto (riesgo S2 de la especificación) y es uno de los motivos por los que este documento está pendiente de revisión legal: la admisibilidad y las garantías exigibles bajo la Ley 21.719 deben confirmarse con un abogado antes del lanzamiento comercial.",
    ],
  },
  {
    id: "retencion",
    heading: "6. Cuánto tiempo los conservamos",
    paragraphs: [
      "La retención depende del tipo de dato. Hay una regla que conviene entender bien: los registros que acreditan la asistencia y el resultado del curso se conservan aunque pidas su supresión, porque prima la obligación legal de fiscalización de SENCE. El resto de tus datos sí se suprime.",
      "⚠ Los plazos de esta tabla son valores por defecto razonables y están marcados para revisión legal; pueden ajustarse tras esa revisión.",
    ],
  },
  {
    id: "derechos",
    heading: "7. Tus derechos",
    paragraphs: [
      "La Ley 21.719 te reconoce los derechos de acceso, rectificación, supresión (cancelación), oposición y portabilidad sobre tus datos personales.",
      "En la plataforma estos derechos no son una promesa en papel: si tienes cuenta, puedes descargar todos tus datos en formato JSON y presentar una solicitud desde tu portal del titular, y la OTEC responsable la resuelve desde su consola. Las supresiones se ejecutan de verdad sobre tu perfil, tus mensajes y tus publicaciones; lo que se conserva por obligación legal se te informa con su motivo.",
      "El derecho de supresión no es absoluto: no alcanza a los registros de asistencia SENCE, certificados, calificaciones ni a la bitácora de auditoría mientras dure la obligación legal de conservarlos.",
      "También puedes oponerte al tratamiento y revocar tu consentimiento para los tratamientos que se basan en él, sin que eso afecte la licitud del tratamiento previo. Ten presente que sin los datos exigidos por SENCE la OTEC no puede validar tu asistencia ante la franquicia.",
      "Si consideras que tus derechos no fueron respetados, puedes reclamar ante la Agencia de Protección de Datos Personales, conforme a la Ley 21.719.",
    ],
  },
  {
    id: "seguridad",
    heading: "8. Seguridad",
    paragraphs: [
      "Cada OTEC vive en un espacio aislado del resto: el aislamiento se aplica en la propia base de datos (Row Level Security en todas las tablas de negocio) y está cubierto por una suite de tests dedicada que corre en cada cambio.",
      "Otras medidas: cifrado en tránsito (TLS) y en reposo; cifrado a nivel de aplicación del token SENCE de cada OTEC; registros de auditoría y de eventos SENCE que solo permiten inserción (no se pueden alterar ni borrar); control de acceso por rol; respaldos diarios cifrados fuera del proveedor principal, con ensayos de restauración documentados; y depuración de datos personales en los reportes de errores.",
      "Ningún sistema es infalible. Si ocurre una vulneración de seguridad que afecte datos personales, notificamos a la OTEC responsable sin demora indebida para que ella cumpla con sus obligaciones de notificación.",
    ],
  },
  {
    id: "cookies",
    heading: "9. Cookies",
    paragraphs: [
      "Usamos únicamente cookies estrictamente necesarias para mantener tu sesión iniciada y proteger los formularios frente a falsificación de peticiones. No usamos cookies publicitarias ni de analítica de terceros, y esta landing no rastrea a sus visitantes.",
    ],
  },
  {
    id: "cambios",
    heading: "10. Cambios a esta política",
    paragraphs: [
      "Si cambiamos este documento, actualizaremos su versión y su fecha. Los cambios relevantes se comunicarán a las OTECs y, cuando corresponda, se volverá a solicitar el consentimiento de los titulares.",
    ],
  },
  {
    id: "contacto",
    heading: "11. Contacto",
    paragraphs: [
      "Si eres alumno(a): tu primer punto de contacto es la OTEC que te inscribió, que es la responsable de tus datos.",
      "Para consultas sobre esta política o sobre la plataforma, puedes escribirnos al correo de contacto publicado en este sitio.",
      "⚠ Pendiente de completar antes de publicar como política vigente: razón social, RUT, domicilio y correo del delegado o punto de contacto de protección de datos.",
    ],
  },
];

export interface Subprocessor {
  readonly name: string;
  readonly purpose: string;
  readonly location: string;
  /** true = todavía no está activo en la plataforma; se lista por transparencia. */
  readonly conditional: boolean;
}

/**
 * Subencargados. Los `conditional: true` NO están activos hoy: se declaran para
 * que la política no tenga que reescribirse a escondidas el día que se activen.
 * Debe cuadrar con la lista de `docs/legal/CONTRATO-ENCARGO-BORRADOR.md`.
 */
export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    name: "Supabase",
    purpose: "Base de datos, autenticación y almacenamiento de archivos",
    location: "Brasil (São Paulo) — transferencia internacional",
    conditional: false,
  },
  {
    name: "Proveedor de VPS (aplicación y worker)",
    purpose: "Ejecución de la aplicación y de las tareas en segundo plano",
    location: "[REGIÓN POR CONFIRMAR]",
    conditional: false,
  },
  {
    name: "Cloudflare",
    purpose: "DNS, protección de la conexión y respaldos cifrados (R2)",
    location: "Red global",
    conditional: false,
  },
  {
    name: "Resend",
    purpose: "Envío de correos transaccionales (invitaciones, avisos)",
    location: "Estados Unidos",
    conditional: false,
  },
  {
    name: "Bunny Stream",
    purpose: "Alojamiento y reproducción de los videos de los cursos",
    location: "Unión Europea / red global",
    conditional: false,
  },
  {
    name: "Sentry",
    purpose: "Monitoreo de errores (con depuración automática de datos personales y secretos)",
    location: "Estados Unidos / Unión Europea",
    conditional: false,
  },
  {
    // `conditional: true`: n8n NO está desplegado todavía (sigue en el handoff
    // a Edu: "n8n en Coolify" + N8N_WEBHOOK_URL/SECRET; el código degrada a
    // no-op sin él). §4 presenta esta tabla como "la lista vigente", así que
    // declararlo activo diría que hoy trata datos, y no trata ninguno.
    name: "n8n (autoinstalado)",
    purpose: "Automatizaciones periféricas; recibe solo agregados seudonimizados, sin datos personales",
    location: "Misma infraestructura del VPS",
    conditional: true,
  },
  {
    name: "OpenRouter",
    purpose: "Tutor con inteligencia artificial, si la OTEC lo activa. Sin RUN, apellidos, correo, empresa ni datos SENCE; con no-entrenamiento y retención cero",
    location: "Estados Unidos",
    conditional: true,
  },
  {
    name: "Meta (WhatsApp Business)",
    purpose: "Notificaciones por WhatsApp, si la OTEC lo activa y el alumno lo acepta",
    location: "Estados Unidos",
    conditional: true,
  },
];

export interface DataRight {
  readonly name: string;
  readonly description: string;
}

export const DATA_RIGHTS: readonly DataRight[] = [
  { name: "Acceso", description: "Saber qué datos tuyos tratamos y obtener una copia." },
  { name: "Rectificación", description: "Corregir datos inexactos, desactualizados o incompletos." },
  { name: "Supresión", description: "Pedir que se eliminen, salvo los que la ley obliga a conservar." },
  { name: "Oposición", description: "Oponerte a un tratamiento y revocar tu consentimiento." },
  { name: "Portabilidad", description: "Recibir tus datos en un formato estructurado y de uso común (JSON)." },
];
