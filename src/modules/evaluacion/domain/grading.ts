/**
 * Corrección automática de los 3 tipos de pregunta (task 2.1, HU-6.1 —
 * spec D-022 §S4/S5): alternativas y V/F todo-o-nada; pareados proporcional.
 * Dominio puro y DEFENSIVO: una respuesta ausente o malformada vale 0,
 * jamás lanza (el autosave guarda lo que el navegador mande).
 *
 * Los tipos de snapshot NO llevan pauta (viajan al cliente); la pauta vive en
 * `AnswerKey`, que solo existe server-side (columna sin grant).
 */

// ---------- snapshot (visible al alumno) ----------

export interface McChoiceSnapshot {
  readonly id: string;
  readonly text: string;
}

export interface McSnapshot {
  readonly id: string;
  readonly kind: "multiple_choice";
  readonly prompt: string;
  readonly points: number;
  readonly choices: readonly McChoiceSnapshot[];
}

export interface TfSnapshot {
  readonly id: string;
  readonly kind: "true_false";
  readonly prompt: string;
  readonly points: number;
}

export interface MatchingSnapshot {
  readonly id: string;
  readonly kind: "matching";
  readonly prompt: string;
  readonly points: number;
  /** Lados izquierdo (fijo) y derecho (barajado) — el alumno los une. */
  readonly lefts: readonly { id: string; text: string }[];
  readonly rights: readonly { id: string; text: string }[];
}

export type QuestionSnapshot = McSnapshot | TfSnapshot | MatchingSnapshot;

// ---------- pauta (solo server) ----------

export type AnswerKeyEntry =
  | { readonly kind: "multiple_choice"; readonly correctChoiceId: string }
  | { readonly kind: "true_false"; readonly correct: boolean }
  | { readonly kind: "matching"; readonly pairs: Readonly<Record<string, string>> }; // leftId → rightId

export type AnswerKey = Readonly<Record<string, AnswerKeyEntry>>;

/** Respuestas crudas del autosave {questionId: unknown}. */
export type AttemptAnswers = Readonly<Record<string, unknown>>;

// ---------- corrección ----------

export interface QuestionScore {
  readonly questionId: string;
  readonly earned: number;
  readonly max: number;
}

/** Puntúa UNA pregunta contra su pauta. Respuesta rara/ausente ⇒ 0. */
export function scoreQuestion(
  snapshot: QuestionSnapshot,
  key: AnswerKeyEntry | undefined,
  answer: unknown,
): QuestionScore {
  const base = { questionId: snapshot.id, max: snapshot.points };
  if (!key || key.kind !== snapshot.kind) return { ...base, earned: 0 };

  if (key.kind === "multiple_choice") {
    return { ...base, earned: answer === key.correctChoiceId ? snapshot.points : 0 };
  }

  if (key.kind === "true_false") {
    const value =
      typeof answer === "boolean" ? answer : answer === "true" ? true : answer === "false" ? false : null;
    return { ...base, earned: value === key.correct ? snapshot.points : 0 };
  }

  // matching: proporcional (S4). answer esperada: {leftId: rightId}.
  const pairs = Object.entries(key.pairs);
  if (pairs.length === 0) return { ...base, earned: 0 };
  const given = (typeof answer === "object" && answer !== null ? answer : {}) as Record<
    string,
    unknown
  >;
  const correct = pairs.filter(([leftId, rightId]) => given[leftId] === rightId).length;
  const earned = Math.round(((correct / pairs.length) * snapshot.points + Number.EPSILON) * 100) / 100;
  return { ...base, earned };
}

export interface AttemptScore {
  readonly score: number;
  readonly maxScore: number;
  readonly perQuestion: readonly QuestionScore[];
}

/** Puntúa el intento completo contra el snapshot congelado. */
export function scoreAttempt(
  snapshot: readonly QuestionSnapshot[],
  key: AnswerKey,
  answers: AttemptAnswers,
): AttemptScore {
  const perQuestion = snapshot.map((q) => scoreQuestion(q, key[q.id], answers[q.id]));
  const score = Math.round(perQuestion.reduce((acc, s) => acc + s.earned, 0) * 100) / 100;
  const maxScore = Math.round(perQuestion.reduce((acc, s) => acc + s.max, 0) * 100) / 100;
  return { score, maxScore, perQuestion };
}
