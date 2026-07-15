import { describe, expect, it } from "vitest";

import {
  buildAttemptSnapshot,
  canReview,
  canStartAttempt,
  EXPIRY_GRACE_MS,
  isAttemptExpired,
  parseQuestionInput,
  parseQuizInput,
  selectQuizGrade,
  type QuestionRow,
} from "./quiz";

/** RNG determinista (LCG simple) para tests reproducibles. */
function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const BANK: QuestionRow[] = [
  {
    id: "q1",
    kind: "multiple_choice",
    prompt: "MC",
    points: 2,
    body: {
      choices: [
        { id: "a", text: "A", correct: false },
        { id: "b", text: "B", correct: true },
        { id: "c", text: "C", correct: false },
      ],
    },
  },
  { id: "q2", kind: "true_false", prompt: "TF", points: 1, body: { correct: true } },
  {
    id: "q3",
    kind: "matching",
    prompt: "M",
    points: 3,
    body: {
      pairs: [
        { id: "p1", left: "1", right: "uno" },
        { id: "p2", left: "2", right: "dos" },
      ],
    },
  },
];

describe("buildAttemptSnapshot (D-022 §S3)", () => {
  it("el snapshot JAMÁS lleva la pauta; la answer key va aparte", () => {
    const built = buildAttemptSnapshot(
      BANK,
      { poolSize: null, shuffleQuestions: true, shuffleChoices: true },
      seededRng(42),
    );
    const json = JSON.stringify(built.snapshot);
    expect(json).not.toContain("correct");
    expect(json).not.toContain("right\":"); // los pares del snapshot no unen lados
    expect(built.answerKey.q1).toEqual({ kind: "multiple_choice", correctChoiceId: "b" });
    expect(built.answerKey.q3).toEqual({ kind: "matching", pairs: { p1: "p1", p2: "p2" } });
    expect(built.maxScore).toBe(6);
  });

  it("pool_size submuestra y el barajado es determinista con el mismo RNG", () => {
    const a = buildAttemptSnapshot(
      BANK,
      { poolSize: 2, shuffleQuestions: true, shuffleChoices: true },
      seededRng(7),
    );
    const b = buildAttemptSnapshot(
      BANK,
      { poolSize: 2, shuffleQuestions: true, shuffleChoices: true },
      seededRng(7),
    );
    expect(a.snapshot).toHaveLength(2);
    expect(a.snapshot.map((q) => q.id)).toEqual(b.snapshot.map((q) => q.id));
  });

  it("sin shuffle: el orden del banco se respeta", () => {
    const built = buildAttemptSnapshot(
      BANK,
      { poolSize: null, shuffleQuestions: false, shuffleChoices: false },
      seededRng(1),
    );
    expect(built.snapshot.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
  });

  it("preguntas con banco corrupto (MC sin correcta) se saltan sin lanzar", () => {
    const corrupt: QuestionRow[] = [
      {
        id: "qx",
        kind: "multiple_choice",
        prompt: "X",
        points: 1,
        body: { choices: [{ id: "a", text: "A", correct: false }] },
      },
    ];
    const built = buildAttemptSnapshot(
      corrupt,
      { poolSize: null, shuffleQuestions: false, shuffleChoices: false },
      seededRng(1),
    );
    expect(built.snapshot).toEqual([]);
    expect(built.maxScore).toBe(0);
  });
});

describe("canStartAttempt (S2)", () => {
  const base = {
    status: "published",
    questionCount: 3,
    maxAttempts: 2 as number | null,
    attemptsUsed: 0,
    opensAt: null as number | null,
    closesAt: null as number | null,
    hasOpenAttempt: false,
    now: 1_000,
  };
  it("puertas: borrador, sin preguntas, ya abierto, agotados, ventana", () => {
    expect(canStartAttempt(base)).toEqual({ ok: true });
    expect(canStartAttempt({ ...base, status: "draft" })).toEqual({
      ok: false,
      reason: "not_published",
    });
    expect(canStartAttempt({ ...base, questionCount: 0 })).toEqual({
      ok: false,
      reason: "no_questions",
    });
    expect(canStartAttempt({ ...base, hasOpenAttempt: true })).toEqual({
      ok: false,
      reason: "already_open",
    });
    expect(canStartAttempt({ ...base, attemptsUsed: 2 })).toEqual({
      ok: false,
      reason: "no_attempts_left",
    });
    expect(canStartAttempt({ ...base, maxAttempts: null, attemptsUsed: 99 })).toEqual({
      ok: true,
    });
    expect(canStartAttempt({ ...base, opensAt: 2_000 })).toEqual({ ok: false, reason: "not_open" });
    expect(canStartAttempt({ ...base, closesAt: 500 })).toEqual({ ok: false, reason: "closed" });
  });
});

describe("isAttemptExpired (S6) y selectQuizGrade (S2)", () => {
  it("expira solo pasada la gracia de 60 s", () => {
    expect(isAttemptExpired(1_000, 1_000 + EXPIRY_GRACE_MS)).toBe(false);
    expect(isAttemptExpired(1_000, 1_000 + EXPIRY_GRACE_MS + 1)).toBe(true);
    expect(isAttemptExpired(null, 999_999)).toBe(false);
  });

  it("best/last/average", () => {
    expect(selectQuizGrade([4.0, 6.5, 5.0], "best")).toBe(6.5);
    expect(selectQuizGrade([4.0, 6.5, 5.0], "last")).toBe(5.0);
    expect(selectQuizGrade([4.0, 6.0], "average")).toBe(5.0);
    expect(selectQuizGrade([], "best")).toBeNull();
  });
});

describe("canReview (S7)", () => {
  it("nunca en curso; after_submit al enviar; after_close espera el cierre", () => {
    const base = { policy: "after_submit" as const, closesAt: null, attemptStatus: "submitted", now: 10 };
    expect(canReview({ ...base, attemptStatus: "in_progress" })).toBe(false);
    expect(canReview(base)).toBe(true);
    expect(canReview({ ...base, policy: "never" })).toBe(false);
    expect(canReview({ ...base, policy: "after_close", closesAt: 20 })).toBe(false);
    expect(canReview({ ...base, policy: "after_close", closesAt: 5 })).toBe(true);
  });
});

describe("parseQuizInput / parseQuestionInput", () => {
  it("quiz válido con defaults", () => {
    const r = parseQuizInput({ title: "Quiz 1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.passingPct).toBe(60);
      expect(r.value.attemptScoring).toBe("best");
      expect(r.value.maxAttempts).toBeNull();
    }
  });

  it("quiz inválido acumula errores por campo", () => {
    const r = parseQuizInput({ title: "", passingPct: 150, maxAttempts: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.field).sort()).toEqual(
        ["maxAttempts", "passingPct", "title"],
      );
    }
  });

  it("pregunta MC exige exactamente UNA correcta (S5)", () => {
    const twoCorrect = parseQuestionInput({
      kind: "multiple_choice",
      prompt: "¿?",
      choices: [
        { id: "a", text: "A", correct: true },
        { id: "b", text: "B", correct: true },
      ],
    });
    expect(twoCorrect.ok).toBe(false);

    const good = parseQuestionInput({
      kind: "true_false",
      prompt: "¿?",
      correct: "true",
    });
    expect(good.ok).toBe(true);
  });

  it("pareados exigen 2–10 pares completos", () => {
    const r = parseQuestionInput({
      kind: "matching",
      prompt: "Une",
      pairs: [{ id: "p1", left: "1", right: "uno" }],
    });
    expect(r.ok).toBe(false);
  });
});
