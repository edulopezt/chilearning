/**
 * Dominio puro de la encuesta de satisfacción (task 3.1, HU-6.3). Valida la
 * plantilla (parseSurveyInput), valida una respuesta contra la plantilla
 * (validateAnswers), y agrega respuestas por acción (aggregateSurvey). Sin IO.
 *
 * Tipos v1 (D-105): `scale` (Likert 1..scaleMax), `single` (una opción), `text`.
 * El anonimato es estructural en la BD (survey_responses.enrollment_id NULL);
 * la agregación aquí nunca necesita saber quién respondió qué.
 */

import { toCsv } from "@/modules/reportes/domain/cumplimiento";

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: FieldError[] };

export type SurveyQuestionType = "scale" | "single" | "text";

export interface SurveyOption {
  readonly id: string;
  readonly text: string;
}

export interface SurveyQuestion {
  readonly id: string;
  readonly type: SurveyQuestionType;
  readonly label: string;
  readonly required: boolean;
  /** Solo `single`: 2..10 opciones. */
  readonly options?: readonly SurveyOption[];
  /** Solo `scale`: tope de la escala Likert (2..10, default 5). */
  readonly scaleMax?: number;
}

export interface SurveyInput {
  readonly title: string;
  readonly intro: string;
  readonly anonymous: boolean;
  readonly questions: readonly SurveyQuestion[];
}

const TYPES: readonly SurveyQuestionType[] = ["scale", "single", "text"];
const MAX_QUESTIONS = 50;
const MAX_TEXT_ANSWER = 4000;

function asBool(v: unknown, fallback = false): boolean {
  if (v === true || v === "true" || v === "on" || v === "1" || v === 1) return true;
  if (v === false || v === "false" || v === "0" || v === 0) return false;
  return fallback;
}

function slug(i: number): string {
  return `q${i + 1}`;
}

/** Valida y normaliza la plantilla de encuesta desde entrada desconocida. */
export function parseSurveyInput(raw: {
  title?: unknown;
  intro?: unknown;
  anonymous?: unknown;
  questions?: unknown;
}): ParseResult<SurveyInput> {
  const errors: FieldError[] = [];

  const title = String(raw.title ?? "").trim();
  if (title.length < 1 || title.length > 200) {
    errors.push({ field: "title", message: "El título es obligatorio (máx. 200 caracteres)." });
  }
  const intro = String(raw.intro ?? "").trim();
  if (intro.length > 2000) {
    errors.push({ field: "intro", message: "La introducción es demasiado larga (máx. 2000)." });
  }
  const anonymous = asBool(raw.anonymous, true);

  const rawQuestions = Array.isArray(raw.questions) ? raw.questions : [];
  if (rawQuestions.length < 1 || rawQuestions.length > MAX_QUESTIONS) {
    errors.push({ field: "questions", message: `Agrega entre 1 y ${MAX_QUESTIONS} preguntas.` });
  }

  const questions: SurveyQuestion[] = [];
  rawQuestions.forEach((q, i) => {
    const obj = (typeof q === "object" && q !== null ? q : {}) as Record<string, unknown>;
    const id = String(obj.id ?? slug(i)).trim() || slug(i);
    const type = String(obj.type ?? "") as SurveyQuestionType;
    if (!TYPES.includes(type)) {
      errors.push({ field: `questions.${i}.type`, message: "Tipo de pregunta inválido." });
      return;
    }
    const label = String(obj.label ?? "").trim();
    if (label.length < 1 || label.length > 500) {
      errors.push({ field: `questions.${i}.label`, message: "El enunciado es obligatorio (máx. 500)." });
    }
    const required = asBool(obj.required, false);

    if (type === "single") {
      const rawOptions = Array.isArray(obj.options) ? obj.options : [];
      const options = rawOptions
        .map((o, j) => {
          const oo = (typeof o === "object" && o !== null ? o : {}) as Record<string, unknown>;
          return { id: String(oo.id ?? `o${j + 1}`).trim() || `o${j + 1}`, text: String(oo.text ?? "").trim() };
        })
        .filter((o) => o.text !== "");
      const uniqueIds = new Set(options.map((o) => o.id));
      if (options.length < 2 || options.length > 10) {
        errors.push({ field: `questions.${i}.options`, message: "Entre 2 y 10 opciones con texto." });
      } else if (uniqueIds.size !== options.length) {
        errors.push({ field: `questions.${i}.options`, message: "Las opciones deben tener id único." });
      } else {
        questions.push({ id, type, label, required, options });
      }
    } else if (type === "scale") {
      const scaleMax = Number(obj.scaleMax ?? 5);
      if (!Number.isInteger(scaleMax) || scaleMax < 2 || scaleMax > 10) {
        errors.push({ field: `questions.${i}.scaleMax`, message: "La escala debe ir de 2 a 10." });
      } else {
        questions.push({ id, type, label, required, scaleMax });
      }
    } else {
      questions.push({ id, type, label, required });
    }
  });

  // ids de pregunta duplicados romperían la agregación y el mapeo de respuestas.
  const ids = questions.map((q) => q.id);
  if (new Set(ids).size !== ids.length) {
    errors.push({ field: "questions", message: "Las preguntas deben tener id único." });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { title, intro, anonymous, questions } };
}

export type SurveyAnswers = Record<string, number | string>;

/**
 * Valida una respuesta del alumno contra la plantilla. Devuelve las respuestas
 * normalizadas (solo las de preguntas conocidas) o la lista de errores.
 */
export function validateAnswers(
  questions: readonly SurveyQuestion[],
  raw: unknown,
): ParseResult<SurveyAnswers> {
  const errors: FieldError[] = [];
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const answers: SurveyAnswers = {};

  for (const q of questions) {
    const value = input[q.id];
    const missing = value === undefined || value === null || value === "";

    if (missing) {
      if (q.required) errors.push({ field: q.id, message: "Esta pregunta es obligatoria." });
      continue;
    }

    if (q.type === "scale") {
      const n = Number(value);
      const max = q.scaleMax ?? 5;
      if (!Number.isInteger(n) || n < 1 || n > max) {
        errors.push({ field: q.id, message: `Selecciona un valor entre 1 y ${max}.` });
      } else {
        answers[q.id] = n;
      }
    } else if (q.type === "single") {
      const optionId = String(value);
      if (!(q.options ?? []).some((o) => o.id === optionId)) {
        errors.push({ field: q.id, message: "Opción inválida." });
      } else {
        answers[q.id] = optionId;
      }
    } else {
      const text = String(value).trim();
      if (text.length > MAX_TEXT_ANSWER) {
        errors.push({ field: q.id, message: `Respuesta demasiado larga (máx. ${MAX_TEXT_ANSWER}).` });
      } else if (text !== "") {
        answers[q.id] = text;
      } else if (q.required) {
        errors.push({ field: q.id, message: "Esta pregunta es obligatoria." });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: answers };
}

// ---------- agregación por acción ----------

export interface ScaleAggregate {
  readonly type: "scale";
  readonly questionId: string;
  readonly label: string;
  readonly n: number;
  readonly average: number | null;
  /** valor (1..scaleMax) → conteo. */
  readonly distribution: ReadonlyMap<number, number>;
  readonly scaleMax: number;
}
export interface SingleAggregate {
  readonly type: "single";
  readonly questionId: string;
  readonly label: string;
  readonly n: number;
  readonly counts: readonly { optionId: string; text: string; count: number }[];
}
export interface TextAggregate {
  readonly type: "text";
  readonly questionId: string;
  readonly label: string;
  readonly n: number;
  /** Textos anónimos (no correlacionables a una persona). */
  readonly texts: readonly string[];
}
export type QuestionAggregate = ScaleAggregate | SingleAggregate | TextAggregate;

export interface SurveyAggregate {
  readonly total: number;
  readonly questions: readonly QuestionAggregate[];
}

/** Agrega las respuestas de una acción (distribuciones, promedio, textos). */
export function aggregateSurvey(
  questions: readonly SurveyQuestion[],
  responses: readonly SurveyAnswers[],
): SurveyAggregate {
  const perQuestion: QuestionAggregate[] = questions.map((q) => {
    const values = responses.map((r) => r[q.id]).filter((v) => v !== undefined && v !== null && v !== "");
    if (q.type === "scale") {
      const scaleMax = q.scaleMax ?? 5;
      const nums = values.map((v) => Number(v)).filter((n) => Number.isInteger(n));
      const distribution = new Map<number, number>();
      for (let i = 1; i <= scaleMax; i += 1) distribution.set(i, 0);
      for (const n of nums) distribution.set(n, (distribution.get(n) ?? 0) + 1);
      const average = nums.length > 0 ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null;
      return { type: "scale", questionId: q.id, label: q.label, n: nums.length, average, distribution, scaleMax };
    }
    if (q.type === "single") {
      const counts = (q.options ?? []).map((o) => ({
        optionId: o.id,
        text: o.text,
        count: values.filter((v) => String(v) === o.id).length,
      }));
      const n = counts.reduce((acc, c) => acc + c.count, 0);
      return { type: "single", questionId: q.id, label: q.label, n, counts };
    }
    const texts = values.map((v) => String(v));
    return { type: "text", questionId: q.id, label: q.label, n: texts.length, texts };
  });

  return { total: responses.length, questions: perQuestion };
}

export interface SurveyCsvLabels {
  readonly question: string;
  readonly type: string;
  readonly answers: string;
  readonly summary: string;
  readonly scale: string;
  readonly single: string;
  readonly text: string;
}

/** Encabezados + filas del agregado (una fila por pregunta). Base de CSV/xlsx. */
export function surveyResultsRows(
  aggregate: SurveyAggregate,
  labels: SurveyCsvLabels,
): { headers: string[]; rows: string[][] } {
  const typeLabel: Record<SurveyQuestionType, string> = {
    scale: labels.scale,
    single: labels.single,
    text: labels.text,
  };
  const rows: string[][] = aggregate.questions.map((q) => {
    if (q.type === "scale") {
      const dist = [...q.distribution.entries()].map(([v, c]) => `${v}:${c}`).join(" ");
      const summary = q.average === null ? "—" : `${labels.summary}: ${q.average.toFixed(2)} (n=${q.n}) [${dist}]`;
      return [q.label, typeLabel.scale, String(q.n), summary];
    }
    if (q.type === "single") {
      const summary = q.counts.map((c) => `${c.text}: ${c.count}`).join(" · ");
      return [q.label, typeLabel.single, String(q.n), summary];
    }
    return [q.label, typeLabel.text, String(q.n), q.texts.join(" | ")];
  });
  return { headers: [labels.question, labels.type, labels.answers, labels.summary], rows };
}

/** Exporta el agregado a CSV (una fila por pregunta, resumen legible). */
export function surveyResultsToCsv(aggregate: SurveyAggregate, labels: SurveyCsvLabels): string {
  const { headers, rows } = surveyResultsRows(aggregate, labels);
  return toCsv(headers, rows);
}
