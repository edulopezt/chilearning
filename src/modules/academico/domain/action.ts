/**
 * Dominio puro de acciones de capacitación SENCE (task 1.2). Valida la entrada
 * del CRUD respetando los quirks del protocolo (I-8/I-10/I-11). Sin IO.
 */

export const TRAINING_LINES = [1, 3, 6] as const;
export type TrainingLine = (typeof TRAINING_LINES)[number];

export const ACTION_ENVIRONMENTS = ["rcetest", "rce"] as const;
export type ActionEnvironment = (typeof ACTION_ENVIRONMENTS)[number];

export interface ActionInput {
  courseId: string;
  codigoAccion: string;
  trainingLine: TrainingLine;
  environment: ActionEnvironment;
  attendanceLock: boolean;
  startsOn: string | null;
  endsOn: string | null;
}

export type ActionField =
  | "courseId"
  | "codigoAccion"
  | "trainingLine"
  | "environment"
  | "dates";

export interface ActionFieldError {
  field: ActionField;
  message: string;
}

export type ActionParseResult =
  | { ok: true; value: ActionInput }
  | { ok: false; errors: ActionFieldError[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asBool(v: unknown): boolean {
  return v === true || v === "true" || v === "on" || v === "1" || v === 1;
}

function normalizeDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return s === "" ? null : s;
}

export function parseActionInput(raw: {
  courseId?: unknown;
  codigoAccion?: unknown;
  trainingLine?: unknown;
  environment?: unknown;
  attendanceLock?: unknown;
  startsOn?: unknown;
  endsOn?: unknown;
}): ActionParseResult {
  const errors: ActionFieldError[] = [];

  const courseId = String(raw.courseId ?? "").trim();
  if (courseId === "") {
    errors.push({ field: "courseId", message: "Debes elegir el curso de la acción." });
  }

  const environment = String(raw.environment ?? "") as ActionEnvironment;
  if (!ACTION_ENVIRONMENTS.includes(environment)) {
    errors.push({ field: "environment", message: "Ambiente inválido." });
  }

  const lineNum = Number(raw.trainingLine);
  const trainingLine = lineNum as TrainingLine;
  if (!TRAINING_LINES.includes(trainingLine)) {
    errors.push({ field: "trainingLine", message: "La línea de capacitación debe ser 1, 3 o 6." });
  }

  const codigoAccion = String(raw.codigoAccion ?? "").trim();
  if (codigoAccion === "" || codigoAccion.length > 50) {
    errors.push({ field: "codigoAccion", message: "El código de la acción es obligatorio (máx. 50 caracteres)." });
  } else if (codigoAccion === "-1" && environment !== "rcetest") {
    // El comodín -1 desactiva la validación de códigos: SOLO en rcetest (I-8).
    errors.push({ field: "codigoAccion", message: "El comodín -1 solo se permite en el ambiente de pruebas (rcetest)." });
  }

  const startsOn = normalizeDate(raw.startsOn);
  const endsOn = normalizeDate(raw.endsOn);
  for (const [d, val] of [["inicio", startsOn], ["término", endsOn]] as const) {
    if (val !== null && !DATE_RE.test(val)) {
      errors.push({ field: "dates", message: `La fecha de ${d} tiene un formato inválido (AAAA-MM-DD).` });
    }
  }
  if (startsOn && endsOn && DATE_RE.test(startsOn) && DATE_RE.test(endsOn) && startsOn > endsOn) {
    errors.push({ field: "dates", message: "La fecha de inicio no puede ser posterior a la de término." });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      courseId,
      codigoAccion,
      trainingLine,
      environment,
      attendanceLock: asBool(raw.attendanceLock),
      startsOn,
      endsOn,
    },
  };
}
