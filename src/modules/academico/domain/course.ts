/**
 * Dominio puro de cursos (task 1.1, HU-3.1/4.4). Valida la entrada del CRUD y
 * normaliza las reglas de completitud. Sin IO.
 */

export const COURSE_MODALITIES = ["elearning", "blended", "presential"] as const;
export type CourseModality = (typeof COURSE_MODALITIES)[number];

export const COURSE_STATUSES = ["draft", "published"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export interface CompletionRules {
  requireAllLessons: boolean;
  requireSurvey: boolean;
  /** Umbral de asistencia SENCE exigido (0–100). */
  minAttendancePct: number;
}

export interface CourseInput {
  name: string;
  modality: CourseModality;
  hours: number;
  sence: boolean;
  codSence: string | null;
  completionRules: CompletionRules;
  status: CourseStatus;
  /**
   * Vigencia del certificado en meses (task 5.12, HU-7.3). `null` = no vence,
   * y es el default: solo los cursos NORMATIVOS caducan.
   */
  validityMonths: number | null;
}

export type CourseField =
  | "name" | "modality" | "hours" | "codSence" | "completionRules" | "status" | "validityMonths";

export interface FieldError {
  field: CourseField;
  message: string;
}

export type ParseResult =
  | { ok: true; value: CourseInput }
  | { ok: false; errors: FieldError[] };

export const DEFAULT_COMPLETION_RULES: CompletionRules = {
  requireAllLessons: true,
  requireSurvey: false,
  minAttendancePct: 0,
};

function asBool(v: unknown): boolean {
  return v === true || v === "true" || v === "on" || v === "1" || v === 1;
}

/** Normaliza reglas de completitud desde entrada desconocida (form/JSON). */
export function normalizeCompletionRules(raw: unknown): CompletionRules {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const pct = Number(obj.minAttendancePct);
  return {
    requireAllLessons: asBool(obj.requireAllLessons ?? DEFAULT_COMPLETION_RULES.requireAllLessons),
    requireSurvey: asBool(obj.requireSurvey),
    minAttendancePct: Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.round(pct))) : 0,
  };
}

/**
 * Valida la entrada del formulario de curso. Devuelve el valor normalizado o la
 * lista de errores de campo (para reporte en UI).
 */
export type ValidityMonthsParse =
  | { ok: true; value: number | null }
  | { ok: false; error: FieldError };

/**
 * Vigencia en meses desde entrada desconocida (task 5.12, HU-7.3).
 * Vacío/null/0 ⇒ `null` = no vence (un `<input type="number">` vacío manda "").
 * Fuera de 1..120 o no entero ⇒ error de campo: mejor que el coordinador lo
 * corrija a que se emita un certificado con una vigencia que él no quiso.
 *
 * Público y con resultado discriminado para que la edición ACOTADA de la vigencia
 * (`updateCourseValidity`, sin re-enviar el resto del curso) lo reuse igual que
 * `parseCourseInput` (4-ojos MED: la vigencia debe poder fijarse tras el alta).
 */
export function parseValidityMonths(raw: unknown): ValidityMonthsParse {
  if (raw === null || raw === undefined || String(raw).trim() === "") return { ok: true, value: null };
  const months = Number(raw);
  if (!Number.isInteger(months) || months < 0 || months > 120) {
    return {
      ok: false,
      error: { field: "validityMonths", message: "La vigencia debe ser un número entero de meses entre 1 y 120 (vacío = no vence)." },
    };
  }
  return { ok: true, value: months === 0 ? null : months };
}

export function parseCourseInput(raw: {
  name?: unknown;
  modality?: unknown;
  hours?: unknown;
  sence?: unknown;
  codSence?: unknown;
  completionRules?: unknown;
  status?: unknown;
  validityMonths?: unknown;
}): ParseResult {
  const errors: FieldError[] = [];

  const name = String(raw.name ?? "").trim();
  if (name.length < 1 || name.length > 200) {
    errors.push({ field: "name", message: "El nombre del curso es obligatorio (máx. 200 caracteres)." });
  }

  const modality = String(raw.modality ?? "") as CourseModality;
  if (!COURSE_MODALITIES.includes(modality)) {
    errors.push({ field: "modality", message: "Modalidad inválida." });
  }

  const hours = Number(raw.hours);
  if (!Number.isInteger(hours) || hours < 0 || hours > 10000) {
    errors.push({ field: "hours", message: "Las horas deben ser un número entero entre 0 y 10.000." });
  }

  const sence = asBool(raw.sence);
  const codSenceRaw = raw.codSence == null ? "" : String(raw.codSence).trim();
  let codSence: string | null = codSenceRaw === "" ? null : codSenceRaw;
  if (sence) {
    // Un curso SENCE de línea 3/6 requiere CodSence de 10 dígitos. Línea 1 lo
    // deja vacío (va en la acción); esa distinción se afina al crear la acción.
    if (codSence !== null && !/^\d{10}$/.test(codSence)) {
      errors.push({ field: "codSence", message: "El Código SENCE del curso debe tener 10 dígitos." });
    }
  } else {
    codSence = null; // sin SENCE no se guarda código
  }

  const status = String(raw.status ?? "draft") as CourseStatus;
  if (!COURSE_STATUSES.includes(status)) {
    errors.push({ field: "status", message: "Estado inválido." });
  }

  const completionRules = normalizeCompletionRules(raw.completionRules);
  const validityParse = parseValidityMonths(raw.validityMonths);
  if (!validityParse.ok) errors.push(validityParse.error);
  const validityMonths = validityParse.ok ? validityParse.value : null;

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name, modality, hours, sence, codSence, completionRules, status, validityMonths },
  };
}
