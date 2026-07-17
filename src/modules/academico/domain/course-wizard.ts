/**
 * Dominio puro del asistente guiado de creación de cursos (task 5.10,
 * HU-3.5/4.5). Valida cada paso del wizard REUSANDO los parsers existentes
 * (`parseCourseInput`, `parseLessonInput`, `normalizeCompletionRules`) y agrega
 * las validaciones específicas de cada paso pedidas por los CA (horas
 * coherentes y ≥1 evaluación por módulo en cursos SENCE, encuesta habilitada).
 * Sin IO — el estado vive en `course_drafts.state` (jsonb); lo persiste
 * `wizard-service.ts`.
 */

import {
  normalizeCompletionRules,
  parseCourseInput,
  type CompletionRules,
  type CourseInput,
} from "@/modules/academico/domain/course";
import { parseLessonInput, type LessonKind } from "@/modules/academico/domain/lesson";

export const WIZARD_STEPS = [
  "datos",
  "estructura",
  "aprendizajes",
  "contenido",
  "evaluaciones",
  "completitud",
  "revision",
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export interface WizardModule {
  readonly id: string;
  readonly title: string;
  readonly hours: number;
}
export interface WizardEstructura {
  readonly modules: readonly WizardModule[];
}

/** Aprendizajes esperados por módulo (id de módulo → lista de enunciados). */
export type WizardAprendizajes = Readonly<Record<string, readonly string[]>>;

export interface WizardLesson {
  readonly moduleId: string;
  readonly title: string;
  readonly kind: LessonKind;
  readonly content: string;
}
export interface WizardContenido {
  readonly lessons: readonly WizardLesson[];
}

export interface WizardQuiz {
  readonly moduleId: string;
  readonly title: string;
}
export interface WizardSurvey {
  readonly enabled: boolean;
  readonly title: string;
}
export interface WizardEvaluaciones {
  readonly quizzes: readonly WizardQuiz[];
  readonly survey: WizardSurvey;
}

/** Sugerencias SIN VALIDAR extraídas de un descriptor SENCE, para prellenar el paso "datos". */
export interface WizardDatosSeed {
  readonly name: string | null;
  readonly hours: number | null;
}

export interface WizardState {
  readonly datos: CourseInput | null;
  readonly estructura: WizardEstructura;
  readonly aprendizajes: WizardAprendizajes;
  readonly contenido: WizardContenido;
  readonly evaluaciones: WizardEvaluaciones;
  readonly completitud: CompletionRules | null;
  readonly datosSeed: WizardDatosSeed;
  /** Aprendizajes esperados detectados en el descriptor SIN asignar a un módulo (el usuario los reparte en el paso "aprendizajes"). */
  readonly outcomesSeed: readonly string[];
  /** Avisos de la extracción determinista del descriptor ("revisa esto a mano"). */
  readonly extractWarnings: readonly string[];
}

export const EMPTY_WIZARD_STATE: WizardState = {
  datos: null,
  estructura: { modules: [] },
  aprendizajes: {},
  contenido: { lessons: [] },
  evaluaciones: { quizzes: [], survey: { enabled: false, title: "" } },
  completitud: null,
  datosSeed: { name: null, hours: null },
  outcomesSeed: [],
  extractWarnings: [],
};

/** Coerción defensiva de un jsonb crudo (BD) a un `WizardState` bien formado. */
export function hydrateWizardState(raw: unknown): WizardState {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<WizardState>;
  return { ...EMPTY_WIZARD_STATE, ...obj };
}

export type WizardStepResult =
  | { readonly ok: true; readonly state: WizardState }
  | { readonly ok: false; readonly errors: Record<string, string> };

function asRecord(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
}

function asBool(v: unknown): boolean {
  return v === true || v === "true" || v === "on" || v === "1" || v === 1;
}

function toErrorRecord(errors: readonly { field: string; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of errors) out[e.field] = e.message;
  return out;
}

// ---------- paso "datos" ----------

function parseDatosStep(raw: unknown, state: WizardState): WizardStepResult {
  const obj = asRecord(raw);
  // El estado nace SIEMPRE en borrador (CA: "nada se publica sin revisión
  // humana") — el status que traiga `raw` (si trae alguno) se ignora a propósito.
  const parsed = parseCourseInput({
    name: obj.name,
    modality: obj.modality,
    hours: obj.hours,
    sence: obj.sence,
    codSence: obj.codSence,
    completionRules: state.completitud ?? undefined,
    status: "draft",
    validityMonths: obj.validityMonths,
  });
  if (!parsed.ok) return { ok: false, errors: toErrorRecord(parsed.errors) };
  return { ok: true, state: { ...state, datos: parsed.value } };
}

// ---------- paso "estructura" ----------

function parseModules(raw: unknown): { modules: WizardModule[]; errors: Record<string, string> } {
  const obj = asRecord(raw);
  const rawModules = Array.isArray(obj.modules) ? obj.modules : [];
  const errors: Record<string, string> = {};
  const modules: WizardModule[] = [];
  const seenIds = new Set<string>();

  rawModules.forEach((m, i) => {
    const mo = asRecord(m);
    const id = String(mo.id ?? `m${i + 1}`).trim() || `m${i + 1}`;
    const title = String(mo.title ?? "").trim();
    const hours = Number(mo.hours);
    let rowOk = true;

    if (title.length < 1 || title.length > 200) {
      errors[`modules.${i}.title`] = "El título del módulo es obligatorio (máx. 200 caracteres).";
      rowOk = false;
    }
    if (!Number.isInteger(hours) || hours < 1 || hours > 2000) {
      errors[`modules.${i}.hours`] = "Las horas del módulo deben ser un entero positivo.";
      rowOk = false;
    }
    if (seenIds.has(id)) {
      errors[`modules.${i}.id`] = "Los módulos deben tener un id único.";
      rowOk = false;
    } else {
      seenIds.add(id);
    }
    if (rowOk) modules.push({ id, title, hours });
  });

  if (rawModules.length === 0) {
    errors.modules = "Agrega al menos un módulo.";
  }
  return { modules, errors };
}

function parseEstructuraStep(raw: unknown, state: WizardState): WizardStepResult {
  const { modules, errors } = parseModules(raw);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  if (state.datos?.sence) {
    const total = modules.reduce((acc, m) => acc + m.hours, 0);
    if (total !== state.datos.hours) {
      return {
        ok: false,
        errors: {
          hours: `La suma de horas de los módulos (${total}) debe ser igual a las horas del curso (${state.datos.hours}).`,
        },
      };
    }
  }

  return { ok: true, state: { ...state, estructura: { modules } } };
}

// ---------- paso "aprendizajes" ----------

function parseAprendizajesStep(raw: unknown, state: WizardState): WizardStepResult {
  const obj = asRecord(raw);
  const moduleIds = new Set(state.estructura.modules.map((m) => m.id));
  const aprendizajes: Record<string, string[]> = {};

  for (const [moduleId, value] of Object.entries(obj)) {
    if (!moduleIds.has(moduleId)) continue; // ignora entradas de módulos que ya no existen
    const list = Array.isArray(value)
      ? value.map((v) => String(v).trim())
      : String(value ?? "")
          .split("\n")
          .map((v) => v.trim());
    aprendizajes[moduleId] = list.filter((v) => v.length > 0).slice(0, 50);
  }

  return { ok: true, state: { ...state, aprendizajes } };
}

// ---------- paso "contenido" ----------

function parseContenidoStep(raw: unknown, state: WizardState): WizardStepResult {
  const obj = asRecord(raw);
  const rawLessons = Array.isArray(obj.lessons) ? obj.lessons : [];
  const moduleIds = new Set(state.estructura.modules.map((m) => m.id));
  const errors: Record<string, string> = {};
  const lessons: WizardLesson[] = [];

  rawLessons.forEach((l, i) => {
    const lo = asRecord(l);
    const moduleId = String(lo.moduleId ?? "").trim();
    if (!moduleIds.has(moduleId)) {
      errors[`lessons.${i}.moduleId`] = "La lección debe pertenecer a un módulo de la estructura.";
      return;
    }
    const parsed = parseLessonInput({ title: lo.title, kind: lo.kind, content: lo.content, status: "draft" });
    if (!parsed.ok) {
      for (const e of parsed.errors) errors[`lessons.${i}.${e.field}`] = e.message;
      return;
    }
    lessons.push({ moduleId, title: parsed.value.title, kind: parsed.value.kind, content: parsed.value.content });
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, state: { ...state, contenido: { lessons } } };
}

// ---------- paso "evaluaciones" ----------

/** ≥1 evaluación por módulo de la estructura + encuesta habilitada (solo cursos SENCE). */
function senceEvaluationBlockers(estructura: WizardEstructura, evaluaciones: WizardEvaluaciones): string[] {
  const blockers: string[] = [];
  const quizzedModules = new Set(evaluaciones.quizzes.map((q) => q.moduleId));
  const missing = estructura.modules.filter((m) => !quizzedModules.has(m.id));
  if (missing.length > 0) {
    blockers.push(`Falta al menos una evaluación en: ${missing.map((m) => m.title).join(", ")}.`);
  }
  if (!evaluaciones.survey.enabled) {
    blockers.push("Un curso SENCE debe tener la encuesta de satisfacción habilitada.");
  }
  return blockers;
}

function parseEvaluacionesStep(raw: unknown, state: WizardState): WizardStepResult {
  const obj = asRecord(raw);
  const rawQuizzes = Array.isArray(obj.quizzes) ? obj.quizzes : [];
  const moduleIds = new Set(state.estructura.modules.map((m) => m.id));
  const errors: Record<string, string> = {};
  const quizzes: WizardQuiz[] = [];

  rawQuizzes.forEach((q, i) => {
    const qo = asRecord(q);
    const moduleId = String(qo.moduleId ?? "").trim();
    const title = String(qo.title ?? "").trim();
    if (!moduleIds.has(moduleId)) {
      errors[`quizzes.${i}.moduleId`] = "La evaluación debe pertenecer a un módulo de la estructura.";
      return;
    }
    if (title.length < 1 || title.length > 200) {
      errors[`quizzes.${i}.title`] = "El título de la evaluación es obligatorio (máx. 200 caracteres).";
      return;
    }
    quizzes.push({ moduleId, title });
  });

  const surveyObj = asRecord(obj.survey);
  const enabled = asBool(surveyObj.enabled);
  const surveyTitle = String(surveyObj.title ?? "").trim();
  if (enabled && (surveyTitle.length < 1 || surveyTitle.length > 200)) {
    errors["survey.title"] = "El título de la encuesta es obligatorio si la habilitas (máx. 200 caracteres).";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const evaluaciones: WizardEvaluaciones = { quizzes, survey: { enabled, title: surveyTitle } };

  if (state.datos?.sence) {
    const blockers = senceEvaluationBlockers(state.estructura, evaluaciones);
    if (blockers.length > 0) return { ok: false, errors: { evaluaciones: blockers.join(" ") } };
  }

  return { ok: true, state: { ...state, evaluaciones } };
}

// ---------- paso "completitud" ----------

function parseCompletitudStep(raw: unknown, state: WizardState): WizardStepResult {
  // normalizeCompletionRules jamás falla (siempre normaliza con defaults).
  return { ok: true, state: { ...state, completitud: normalizeCompletionRules(raw) } };
}

// ---------- paso "revision" ----------

function parseRevisionStep(_raw: unknown, state: WizardState): WizardStepResult {
  const result = validateForGeneration(state);
  if (!result.ok) {
    const errors: Record<string, string> = {};
    result.blockers.forEach((b, i) => {
      errors[`blocker_${i}`] = b;
    });
    return { ok: false, errors };
  }
  return { ok: true, state };
}

/** Valida y aplica el paso `step` sobre `currentState`, sin mutarlo. */
export function parseWizardStep(step: WizardStep, raw: unknown, currentState: WizardState): WizardStepResult {
  switch (step) {
    case "datos":
      return parseDatosStep(raw, currentState);
    case "estructura":
      return parseEstructuraStep(raw, currentState);
    case "aprendizajes":
      return parseAprendizajesStep(raw, currentState);
    case "contenido":
      return parseContenidoStep(raw, currentState);
    case "evaluaciones":
      return parseEvaluacionesStep(raw, currentState);
    case "completitud":
      return parseCompletitudStep(raw, currentState);
    case "revision":
      return parseRevisionStep(raw, currentState);
  }
}

// ---------- validación agregada para la revisión final ----------

function structureBlockers(state: WizardState): string[] {
  const blockers: string[] = [];
  if (state.estructura.modules.length === 0) {
    blockers.push("Agrega al menos un módulo a la estructura del curso.");
    return blockers;
  }
  for (const m of state.estructura.modules) {
    if (!Number.isInteger(m.hours) || m.hours < 1) {
      blockers.push(`El módulo "${m.title}" tiene horas inválidas.`);
    }
  }
  if (state.datos?.sence) {
    const total = state.estructura.modules.reduce((acc, m) => acc + m.hours, 0);
    if (total !== state.datos.hours) {
      blockers.push(
        `La suma de horas de los módulos (${total}) no coincide con las horas del curso (${state.datos.hours}).`,
      );
    }
  }
  return blockers;
}

/**
 * Corre TODAS las validaciones de todos los pasos sobre el estado completo
 * (para el paso "revisión final" y como último gate de `generateFromDraft`).
 */
export function validateForGeneration(state: WizardState): { ok: true } | { ok: false; blockers: string[] } {
  const blockers: string[] = [];
  if (!state.datos) blockers.push("Faltan los datos del curso.");
  blockers.push(...structureBlockers(state));
  if (!state.completitud) blockers.push("Faltan las reglas de completitud.");
  if (state.datos?.sence) blockers.push(...senceEvaluationBlockers(state.estructura, state.evaluaciones));

  if (blockers.length > 0) return { ok: false, blockers };
  return { ok: true };
}

// ---------- plantillas precargadas ----------

export interface WizardTemplate {
  readonly id: string;
  readonly label: string;
  /** Estado PARCIAL: solo lo que tiene sentido precargar (estructura, evaluaciones, completitud). */
  readonly state: Partial<WizardState>;
}

export const WIZARD_TEMPLATES: Readonly<Record<string, WizardTemplate>> = {
  elearning_sence_estandar: {
    id: "elearning_sence_estandar",
    label: "E-learning SENCE estándar (3 módulos)",
    state: {
      estructura: {
        modules: [
          { id: "m1", title: "Módulo 1", hours: 4 },
          { id: "m2", title: "Módulo 2", hours: 4 },
          { id: "m3", title: "Módulo 3", hours: 4 },
        ],
      },
      evaluaciones: {
        quizzes: [
          { moduleId: "m1", title: "Evaluación módulo 1" },
          { moduleId: "m2", title: "Evaluación módulo 2" },
          { moduleId: "m3", title: "Evaluación módulo 3" },
        ],
        survey: { enabled: true, title: "Encuesta de satisfacción" },
      },
      completitud: { requireAllLessons: true, requireSurvey: true, minAttendancePct: 75 },
    },
  },
  elearning_libre: {
    id: "elearning_libre",
    label: "E-learning libre (1 módulo, sin SENCE)",
    state: {
      estructura: { modules: [{ id: "m1", title: "Módulo único", hours: 1 }] },
      evaluaciones: { quizzes: [], survey: { enabled: false, title: "" } },
      completitud: { requireAllLessons: true, requireSurvey: false, minAttendancePct: 0 },
    },
  },
};
