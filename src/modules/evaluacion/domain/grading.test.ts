import { describe, expect, it } from "vitest";

import {
  scoreAttempt,
  scoreQuestion,
  type AnswerKey,
  type QuestionSnapshot,
} from "./grading";

const MC: QuestionSnapshot = {
  id: "q1",
  kind: "multiple_choice",
  prompt: "¿?",
  points: 2,
  choices: [
    { id: "a", text: "A" },
    { id: "b", text: "B" },
  ],
};
const TF: QuestionSnapshot = { id: "q2", kind: "true_false", prompt: "¿?", points: 1 };
const MATCH: QuestionSnapshot = {
  id: "q3",
  kind: "matching",
  prompt: "Une",
  points: 3,
  lefts: [
    { id: "p1", text: "1" },
    { id: "p2", text: "2" },
    { id: "p3", text: "3" },
  ],
  rights: [
    { id: "p2", text: "dos" },
    { id: "p1", text: "uno" },
    { id: "p3", text: "tres" },
  ],
};

const KEY: AnswerKey = {
  q1: { kind: "multiple_choice", correctChoiceId: "b" },
  q2: { kind: "true_false", correct: true },
  q3: { kind: "matching", pairs: { p1: "p1", p2: "p2", p3: "p3" } },
};

describe("scoreQuestion (S4/S5)", () => {
  it("alternativas: todo o nada", () => {
    expect(scoreQuestion(MC, KEY.q1, "b").earned).toBe(2);
    expect(scoreQuestion(MC, KEY.q1, "a").earned).toBe(0);
  });

  it("V/F: acepta boolean y string, todo o nada", () => {
    expect(scoreQuestion(TF, KEY.q2, true).earned).toBe(1);
    expect(scoreQuestion(TF, KEY.q2, "true").earned).toBe(1);
    expect(scoreQuestion(TF, KEY.q2, false).earned).toBe(0);
    expect(scoreQuestion(TF, KEY.q2, "cualquier cosa").earned).toBe(0);
  });

  it("pareados: proporcional (0, parcial, total)", () => {
    expect(scoreQuestion(MATCH, KEY.q3, { p1: "p1", p2: "p2", p3: "p3" }).earned).toBe(3);
    expect(scoreQuestion(MATCH, KEY.q3, { p1: "p1", p2: "p3", p3: "p2" }).earned).toBe(1);
    expect(scoreQuestion(MATCH, KEY.q3, {}).earned).toBe(0);
  });

  it("defensivo: respuesta ausente/malformada o pauta desalineada ⇒ 0, sin lanzar", () => {
    expect(scoreQuestion(MC, KEY.q1, undefined).earned).toBe(0);
    expect(scoreQuestion(MC, KEY.q1, { raro: true }).earned).toBe(0);
    expect(scoreQuestion(MC, undefined, "b").earned).toBe(0);
    expect(scoreQuestion(MC, KEY.q2, "b").earned).toBe(0); // pauta de otro tipo
  });
});

describe("scoreAttempt", () => {
  it("suma por pregunta y calcula el máximo", () => {
    const result = scoreAttempt([MC, TF, MATCH], KEY, {
      q1: "b",
      q2: true,
      q3: { p1: "p1", p2: "p2", p3: "p1" }, // 2/3 buenos
    });
    expect(result.maxScore).toBe(6);
    expect(result.score).toBe(5); // 2 + 1 + 2
    expect(result.perQuestion).toHaveLength(3);
  });
});
