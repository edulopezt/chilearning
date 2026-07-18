/**
 * Plantillas de WhatsApp (task 5.11, HU-5.9 — canal WhatsApp). Dominio PURO,
 * sin IO — mismo espíritu que `email-templates.ts`, pero para mensajes
 * template (HSM) de la Cloud API de Meta.
 *
 * Diferencia clave con el correo: Meta exige que el COPY EXACTO de cada
 * plantilla esté pre-aprobado antes de poder enviarse. En runtime la API
 * SOLO recibe los parámetros posicionales (`{{1}}`, `{{2}}`, ...) — nunca el
 * texto completo. `approvedBodyEs` documenta el copy que Edu debe enviar a
 * aprobación (ver `docs/whatsapp/META-BUSINESS-VERIFICATION.md`); es un campo
 * DOCUMENTATIVO, no se envía a la API (`whatsapp-sender.ts` arma el request
 * real con `template.name` + los parámetros, jamás con este texto).
 *
 * Versionado (`_v1`): un cambio de copy futuro exige RE-APROBACIÓN de Meta con
 * un nombre nuevo (`_v2`, ...) — nunca se edita in place una plantilla ya
 * aprobada (rompería los mensajes en tránsito y el historial de aprobación).
 *
 * Minimización (RNF-10): las plantillas solo reciben el PRIMER NOMBRE del
 * alumno — nunca apellido, RUN, correo o empresa. Mismo principio que
 * `tutor-ia/domain/prompt.ts:sanitizeFirstName`; se reimplementa una versión
 * equivalente aquí (en vez de importar desde `tutor-ia`) para no acoplar el
 * módulo `comunicacion` a un módulo ajeno por una función de unas pocas
 * líneas — mismo criterio de aislamiento modular que ya aplica `sence/`.
 * `buildXxxParams` es la ÚNICA puerta: sanea el nombre INTERNAMENTE, así que
 * es seguro pasarle el nombre completo tal como lo resuelve el llamador
 * (`reminders.ts`) sin depender de que el caller recuerde sanear antes.
 */

const CONTROL_CHARS_RE = /\p{Cc}/gu;
const NON_NAME_CHARS_RE = /[^\p{L}'-]/gu;
const HAS_LETTER_RE = /\p{L}/u;
const MAX_FIRST_NAME_CHARS = 40;
const FALLBACK_FIRST_NAME = "Alumno/a";

/**
 * Primer nombre saneado para uso en una plantilla WhatsApp: sin dígitos, sin
 * caracteres de control, sin puntuación; capado a 40 caracteres; cae a
 * `"Alumno/a"` si no queda nada útil. Idempotente: aplicarlo sobre un nombre
 * ya saneado no cambia el resultado.
 */
export function sanitizeFirstNameForWhatsApp(fullNameOrFirstName: string): string {
  const noControl = fullNameOrFirstName.replace(CONTROL_CHARS_RE, " ");
  const firstToken = noControl.trim().split(/\s+/)[0] ?? "";
  const cleaned = firstToken.replace(NON_NAME_CHARS_RE, "").slice(0, MAX_FIRST_NAME_CHARS);
  return HAS_LETTER_RE.test(cleaned) ? cleaned : FALLBACK_FIRST_NAME;
}

export interface WhatsAppTemplate {
  readonly name: string;
  readonly languageCode: string;
  /** Copy EXACTO enviado a aprobación de Meta. Documentativo — NO se envía en runtime. */
  readonly approvedBodyEs: string;
}

/** Recordatorio de asistencia SENCE del día (espejo del `kind:"no_attendance"` del correo). */
export const RECORDATORIO_ASISTENCIA_V1: WhatsAppTemplate = {
  name: "recordatorio_asistencia_v1",
  languageCode: "es",
  approvedBodyEs:
    "Hola {{1}}, aún no registras tu asistencia SENCE de hoy en {{2}}. Ingresa a la plataforma para regularizarla.",
};

/** Aviso a alumnos inactivos (espejo del `kind:"inactive"` del correo). */
export const AVISO_INACTIVO_V1: WhatsAppTemplate = {
  name: "aviso_inactivo_v1",
  languageCode: "es",
  approvedBodyEs: "Hola {{1}}, hace unos días que no ingresas a {{2}}. Retoma cuando puedas.",
};

/**
 * Certificado disponible. Declarada y exportada para cuando exista un tick de
 * "certificado emitido" con canal WhatsApp (fuera del alcance de esta task —
 * hoy no hay llamador); queda lista para ese momento.
 */
export const CERTIFICADO_DISPONIBLE_V1: WhatsAppTemplate = {
  name: "certificado_disponible_v1",
  languageCode: "es",
  approvedBodyEs: "Hola {{1}}, tu certificado de {{2}} ya está disponible en la plataforma.",
};

/** Arma `[firstName, courseName]` para `recordatorio_asistencia_v1`. */
export function buildRecordatorioAsistenciaParams(firstName: string, courseName: string): string[] {
  return [sanitizeFirstNameForWhatsApp(firstName), courseName];
}

/** Arma `[firstName, courseName]` para `aviso_inactivo_v1`. */
export function buildAvisoInactivoParams(firstName: string, courseName: string): string[] {
  return [sanitizeFirstNameForWhatsApp(firstName), courseName];
}

/** Arma `[firstName, courseName]` para `certificado_disponible_v1` (sin llamador aún). */
export function buildCertificadoDisponibleParams(firstName: string, courseName: string): string[] {
  return [sanitizeFirstNameForWhatsApp(firstName), courseName];
}
