import { describe, expect, it } from "vitest";

import {
  aggregateSurvey,
  parseSurveyInput,
  surveyResultsToCsv,
  validateAnswers,
  type SurveyAnswers,
  type SurveyCsvLabels,
  type SurveyQuestion,
} from "./survey";

const CSV_LABELS: SurveyCsvLabels = {
  question: "Pregunta",
  type: "Tipo",
  answers: "Respuestas",
  summary: "Resumen",
  scale: "Escala",
  single: "Opción",
  text: "Texto",
};

describe("parseSurveyInput", () => {
  it("acepta una plantilla válida con los 3 tipos", () => {
    const res = parseSurveyInput({
      title: "Satisfacción del curso",
      anonymous: true,
      questions: [
        { id: "q1", type: "scale", label: "¿Qué tan satisfecho estás?", required: true, scaleMax: 5 },
        {
          id: "q2",
          type: "single",
          label: "¿Recomendarías el curso?",
          required: true,
          options: [
            { id: "si", text: "Sí" },
            { id: "no", text: "No" },
          ],
        },
        { id: "q3", type: "text", label: "Comentarios", required: false },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.questions).toHaveLength(3);
      expect(res.value.anonymous).toBe(true);
    }
  });

  it("por defecto es anónima", () => {
    const res = parseSurveyInput({ title: "T", questions: [{ type: "text", label: "x" }] });
    expect(res.ok && res.value.anonymous).toBe(true);
  });

  it("rechaza título vacío y sin preguntas", () => {
    const res = parseSurveyInput({ title: "", questions: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.field === "title")).toBe(true);
      expect(res.errors.some((e) => e.field === "questions")).toBe(true);
    }
  });

  it("rechaza single con menos de 2 opciones", () => {
    const res = parseSurveyInput({
      title: "T",
      questions: [{ type: "single", label: "x", options: [{ id: "a", text: "A" }] }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.field === "questions.0.options")).toBe(true);
  });

  it("rechaza scale fuera de 2..10", () => {
    const res = parseSurveyInput({
      title: "T",
      questions: [{ type: "scale", label: "x", scaleMax: 1 }],
    });
    expect(res.ok).toBe(false);
  });

  it("rechaza ids de pregunta duplicados", () => {
    const res = parseSurveyInput({
      title: "T",
      questions: [
        { id: "dup", type: "text", label: "a" },
        { id: "dup", type: "text", label: "b" },
      ],
    });
    expect(res.ok).toBe(false);
  });
});

const QUESTIONS: SurveyQuestion[] = [
  { id: "q1", type: "scale", label: "Satisfacción", required: true, scaleMax: 5 },
  {
    id: "q2",
    type: "single",
    label: "¿Recomiendas?",
    required: true,
    options: [
      { id: "si", text: "Sí" },
      { id: "no", text: "No" },
    ],
  },
  { id: "q3", type: "text", label: "Comentario", required: false },
];

describe("validateAnswers", () => {
  it("acepta respuestas válidas y normaliza", () => {
    const res = validateAnswers(QUESTIONS, { q1: "4", q2: "si", q3: "Buen curso" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual({ q1: 4, q2: "si", q3: "Buen curso" });
  });

  it("exige las preguntas obligatorias", () => {
    const res = validateAnswers(QUESTIONS, { q3: "solo comentario" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.field === "q1")).toBe(true);
      expect(res.errors.some((e) => e.field === "q2")).toBe(true);
    }
  });

  it("rechaza escala fuera de rango y opción inexistente", () => {
    const res = validateAnswers(QUESTIONS, { q1: "9", q2: "tal_vez" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.field === "q1")).toBe(true);
      expect(res.errors.some((e) => e.field === "q2")).toBe(true);
    }
  });

  it("omite la pregunta de texto opcional vacía", () => {
    const res = validateAnswers(QUESTIONS, { q1: 5, q2: "no", q3: "" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.q3).toBeUndefined();
  });
});

describe("aggregateSurvey", () => {
  it("agrega escala (promedio + distribución), single (conteos) y texto", () => {
    const responses: SurveyAnswers[] = [
      { q1: 5, q2: "si", q3: "Excelente" },
      { q1: 3, q2: "no", q3: "Regular" },
      { q1: 4, q2: "si" },
    ];
    const agg = aggregateSurvey(QUESTIONS, responses);
    expect(agg.total).toBe(3);

    const scale = agg.questions.find((q) => q.questionId === "q1");
    expect(scale?.type).toBe("scale");
    if (scale?.type === "scale") {
      expect(scale.n).toBe(3);
      expect(scale.average).toBe(4); // (5+3+4)/3
      expect(scale.distribution.get(5)).toBe(1);
      expect(scale.distribution.get(4)).toBe(1);
      expect(scale.distribution.get(3)).toBe(1);
    }

    const single = agg.questions.find((q) => q.questionId === "q2");
    if (single?.type === "single") {
      expect(single.counts.find((c) => c.optionId === "si")?.count).toBe(2);
      expect(single.counts.find((c) => c.optionId === "no")?.count).toBe(1);
    }

    const text = agg.questions.find((q) => q.questionId === "q3");
    if (text?.type === "text") {
      expect(text.texts).toContain("Excelente");
      expect(text.texts).toContain("Regular");
      expect(text.n).toBe(2);
    }
  });

  it("promedio null cuando la escala no tiene respuestas", () => {
    const agg = aggregateSurvey(QUESTIONS, [{ q2: "si" }]);
    const scale = agg.questions.find((q) => q.questionId === "q1");
    if (scale?.type === "scale") expect(scale.average).toBeNull();
  });
});

describe("surveyResultsToCsv", () => {
  it("genera CSV con BOM y una fila por pregunta", () => {
    const agg = aggregateSurvey(QUESTIONS, [{ q1: 4, q2: "si", q3: "ok" }]);
    const csv = surveyResultsToCsv(agg, CSV_LABELS);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Satisfacción");
    expect(csv).toContain("¿Recomiendas?");
  });
});
