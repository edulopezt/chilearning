/**
 * Reglas puras del ciclo de vida del quiz y sus intentos (task 2.1, HU-6.1 —
 * spec D-022): parse de formularios (FieldError[], patrón del repo), armado
 * del snapshot del intento (banco + aleatorización con RNG INYECTADO, S3),
 * puertas de inicio (S2), expiración perezosa (S6), selección de la nota
 * entre intentos (S2) y política de revisión (S7). Sin IO.
 */

import type {
  AnswerKey,
  AnswerKeyEntry,
  QuestionSnapshot,
} from "./grading";

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: FieldError[] };

// ---------- quiz (configuración) ----------

export type AttemptScoringPolicy = "best" | "last" | "average";
export type ReviewPolicy = "never" | "after_submit" | "after_close";

export interface QuizInput {
  readonly title: string;
  readonly description: string;
  readonly timeLimitMinutes: number | null;
  readonly maxAttempts: number | null;
  readonly attemptScoring: AttemptScoringPolicy;
  readonly passingPct: number;
  readonly poolSize: number | null;
  readonly shuffleQuestions: boolean;
  readonly shuffleChoices: boolean;
  readonly reviewPolicy: ReviewPolicy;
  readonly weight: number;
}

const SCORING: readonly AttemptScoringPolicy[] = ["best", "last", "average"];
const REVIEW: readonly ReviewPolicy[] = ["never", "after_submit", "after_close"];

function intOrNull(raw: unknown, min: number, max: number): number | null | "invalid" {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return "invalid";
  return n;
}

export function parseQuizInput(raw: Record<string, unknown>): ParseResult<QuizInput> {
  const errors: FieldError[] = [];

  const title = String(raw.title ?? "").trim();
  if (title.length < 1 || title.length > 200) {
    errors.push({ field: "title", message: "El título es obligatorio (máx. 200)." });
  }

  const timeLimit = intOrNull(raw.timeLimitMinutes, 1, 600);
  if (timeLimit === "invalid") {
    errors.push({ field: "timeLimitMinutes", message: "El tiempo límite debe ser 1–600 minutos." });
  }
  const maxAttempts = intOrNull(raw.maxAttempts, 1, 50);
  if (maxAttempts === "invalid") {
    errors.push({ field: "maxAttempts", message: "Los intentos deben ser 1–50 (vacío = ilimitados)." });
  }
  const poolSize = intOrNull(raw.poolSize, 1, 500);
  if (poolSize === "invalid") {
    errors.push({ field: "poolSize", message: "El tamaño del banco debe ser ≥ 1 (vacío = todas)." });
  }

  const passingPct = Number(raw.passingPct ?? 60);
  if (!Number.isInteger(passingPct) || passingPct < 1 || passingPct > 99) {
    errors.push({ field: "passingPct", message: "La exigencia debe ser un entero 1–99." });
  }

  const attemptScoring = String(raw.attemptScoring ?? "best") as AttemptScoringPolicy;
  if (!SCORING.includes(attemptScoring)) {
    errors.push({ field: "attemptScoring", message: "Política de intentos inválida." });
  }
  const reviewPolicy = String(raw.reviewPolicy ?? "after_submit") as ReviewPolicy;
  if (!REVIEW.includes(reviewPolicy)) {
    errors.push({ field: "reviewPolicy", message: "Política de revisión inválida." });
  }

  const weight = Number(raw.weight ?? 1);
  if (!Number.isFinite(weight) || weight < 0 || weight > 1000) {
    errors.push({ field: "weight", message: "La ponderación debe ser un número ≥ 0." });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      description: String(raw.description ?? "").trim(),
      timeLimitMinutes: timeLimit as number | null,
      maxAttempts: maxAttempts as number | null,
      attemptScoring,
      passingPct,
      poolSize: poolSize as number | null,
      shuffleQuestions: raw.shuffleQuestions !== false && raw.shuffleQuestions !== "false",
      shuffleChoices: raw.shuffleChoices !== false && raw.shuffleChoices !== "false",
      reviewPolicy,
      weight,
    },
  };
}

// ---------- preguntas (body por tipo) ----------

export type QuestionKind = "multiple_choice" | "true_false" | "matching";

export interface QuestionInput {
  readonly kind: QuestionKind;
  readonly prompt: string;
  readonly points: number;
  readonly body:
    | { readonly choices: readonly { id: string; text: string; correct: boolean }[] }
    | { readonly correct: boolean }
    | { readonly pairs: readonly { id: string; left: string; right: string }[] };
}

export function parseQuestionInput(raw: Record<string, unknown>): ParseResult<QuestionInput> {
  const errors: FieldError[] = [];
  const kind = String(raw.kind ?? "") as QuestionKind;
  if (!["multiple_choice", "true_false", "matching"].includes(kind)) {
    return { ok: false, errors: [{ field: "kind", message: "Tipo de pregunta inválido." }] };
  }

  const prompt = String(raw.prompt ?? "").trim();
  if (prompt.length < 1 || prompt.length > 2000) {
    errors.push({ field: "prompt", message: "El enunciado es obligatorio (máx. 2000)." });
  }
  const points = Number(raw.points ?? 1);
  if (!Number.isFinite(points) || points <= 0 || points > 1000) {
    errors.push({ field: "points", message: "El puntaje debe ser mayor que 0." });
  }

  let body: QuestionInput["body"] | null = null;
  if (kind === "multiple_choice") {
    const choices = Array.isArray(raw.choices)
      ? (raw.choices as { id?: unknown; text?: unknown; correct?: unknown }[])
      : [];
    const clean = choices
      .map((c, i) => ({
        id: String(c.id ?? `c${i + 1}`),
        text: String(c.text ?? "").trim(),
        correct: c.correct === true || c.correct === "true",
      }))
      .filter((c) => c.text !== "");
    const correctCount = clean.filter((c) => c.correct).length;
    if (clean.length < 2 || clean.length > 8) {
      errors.push({ field: "choices", message: "Entre 2 y 8 alternativas con texto." });
    } else if (correctCount !== 1) {
      // S5: v1 = exactamente UNA correcta.
      errors.push({ field: "choices", message: "Debe haber exactamente una alternativa correcta." });
    } else {
      body = { choices: clean };
    }
  } else if (kind === "true_false") {
    const correct = raw.correct === true || raw.correct === "true";
    body = { correct };
  } else {
    const pairs = Array.isArray(raw.pairs)
      ? (raw.pairs as { id?: unknown; left?: unknown; right?: unknown }[])
      : [];
    const clean = pairs
      .map((p, i) => ({
        id: String(p.id ?? `p${i + 1}`),
        left: String(p.left ?? "").trim(),
        right: String(p.right ?? "").trim(),
      }))
      .filter((p) => p.left !== "" && p.right !== "");
    if (clean.length < 2 || clean.length > 10) {
      errors.push({ field: "pairs", message: "Entre 2 y 10 pares completos." });
    } else {
      body = { pairs: clean };
    }
  }

  if (errors.length > 0 || body === null) return { ok: false, errors };
  return { ok: true, value: { kind, prompt, points, body } };
}

// ---------- snapshot del intento (S3) ----------

export interface QuestionRow {
  readonly id: string;
  readonly kind: QuestionKind;
  readonly prompt: string;
  readonly points: number;
  readonly body: unknown;
}

/** Fisher–Yates con RNG inyectado (tests deterministas). */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface BuiltSnapshot {
  readonly snapshot: QuestionSnapshot[];
  readonly answerKey: AnswerKey;
  readonly maxScore: number;
}

/**
 * Congela el intento: submuestra del banco (`poolSize`), orden de preguntas y
 * de alternativas/lados (S3). El snapshot que viaja al cliente NO lleva pauta;
 * la pauta va aparte (`answerKey`, columna sin grant).
 */
export function buildAttemptSnapshot(
  questions: readonly QuestionRow[],
  cfg: { poolSize: number | null; shuffleQuestions: boolean; shuffleChoices: boolean },
  rng: () => number,
): BuiltSnapshot {
  let pool = cfg.shuffleQuestions ? shuffle(questions, rng) : [...questions];
  if (cfg.poolSize !== null && cfg.poolSize < pool.length) {
    // Con orden fijo (sin shuffle) la submuestra igual debe ser aleatoria.
    pool = cfg.shuffleQuestions ? pool.slice(0, cfg.poolSize) : shuffle(pool, rng).slice(0, cfg.poolSize);
  }

  const snapshot: QuestionSnapshot[] = [];
  const answerKey: Record<string, AnswerKeyEntry> = {};

  for (const q of pool) {
    const body = (typeof q.body === "object" && q.body !== null ? q.body : {}) as Record<
      string,
      unknown
    >;
    if (q.kind === "multiple_choice") {
      const choices = (Array.isArray(body.choices) ? body.choices : []) as {
        id: string;
        text: string;
        correct: boolean;
      }[];
      const ordered = cfg.shuffleChoices ? shuffle(choices, rng) : [...choices];
      const correct = choices.find((c) => c.correct);
      if (!correct) continue; // banco corrupto: se salta, no se lanza
      snapshot.push({
        id: q.id,
        kind: "multiple_choice",
        prompt: q.prompt,
        points: q.points,
        choices: ordered.map((c) => ({ id: c.id, text: c.text })),
      });
      answerKey[q.id] = { kind: "multiple_choice", correctChoiceId: correct.id };
    } else if (q.kind === "true_false") {
      snapshot.push({ id: q.id, kind: "true_false", prompt: q.prompt, points: q.points });
      answerKey[q.id] = { kind: "true_false", correct: body.correct === true };
    } else {
      const pairs = (Array.isArray(body.pairs) ? body.pairs : []) as {
        id: string;
        left: string;
        right: string;
      }[];
      if (pairs.length === 0) continue;
      const rights = cfg.shuffleChoices ? shuffle(pairs, rng) : [...pairs];
      snapshot.push({
        id: q.id,
        kind: "matching",
        prompt: q.prompt,
        points: q.points,
        lefts: pairs.map((p) => ({ id: p.id, text: p.left })),
        rights: rights.map((p) => ({ id: p.id, text: p.right })),
      });
      answerKey[q.id] = {
        kind: "matching",
        pairs: Object.fromEntries(pairs.map((p) => [p.id, p.id])),
      };
    }
  }

  const maxScore = Math.round(snapshot.reduce((acc, q) => acc + q.points, 0) * 100) / 100;
  return { snapshot, answerKey, maxScore };
}

// ---------- puertas del intento ----------

export type StartDenied =
  | "not_published"
  | "not_open"
  | "closed"
  | "no_attempts_left"
  | "already_open"
  | "no_questions";

export function canStartAttempt(input: {
  readonly status: string;
  readonly questionCount: number;
  readonly maxAttempts: number | null;
  readonly attemptsUsed: number;
  readonly opensAt: number | null;
  readonly closesAt: number | null;
  readonly hasOpenAttempt: boolean;
  readonly now: number;
}): { ok: true } | { ok: false; reason: StartDenied } {
  if (input.status !== "published") return { ok: false, reason: "not_published" };
  if (input.questionCount === 0) return { ok: false, reason: "no_questions" };
  if (input.hasOpenAttempt) return { ok: false, reason: "already_open" };
  if (input.opensAt !== null && input.now < input.opensAt) return { ok: false, reason: "not_open" };
  if (input.closesAt !== null && input.now > input.closesAt) return { ok: false, reason: "closed" };
  if (input.maxAttempts !== null && input.attemptsUsed >= input.maxAttempts) {
    return { ok: false, reason: "no_attempts_left" };
  }
  return { ok: true };
}

/** S6: vencido con gracia de 60 s por clock skew del cliente. */
export const EXPIRY_GRACE_MS = 60_000;

export function isAttemptExpired(expiresAt: number | null, now: number): boolean {
  return expiresAt !== null && now > expiresAt + EXPIRY_GRACE_MS;
}

/** S2: qué nota cuenta entre múltiples intentos. */
export function selectQuizGrade(
  grades: readonly number[],
  policy: AttemptScoringPolicy,
): number | null {
  if (grades.length === 0) return null;
  if (policy === "last") return grades[grades.length - 1] ?? null;
  if (policy === "average") {
    const avg = grades.reduce((a, b) => a + b, 0) / grades.length;
    return Math.round(avg * 10) / 10;
  }
  return Math.max(...grades);
}

/** S7: ¿puede el alumno ver la revisión (respuestas + pauta) de su intento? */
export function canReview(input: {
  readonly policy: ReviewPolicy;
  readonly closesAt: number | null;
  readonly attemptStatus: string;
  readonly now: number;
}): boolean {
  if (input.attemptStatus === "in_progress") return false;
  if (input.policy === "never") return false;
  if (input.policy === "after_submit") return true;
  // after_close: el constraint de BD garantiza closesAt ≠ null.
  return input.closesAt !== null && input.now > input.closesAt;
}
