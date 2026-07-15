import { describe, expect, it } from "vitest";

import {
  lateness,
  parseAssignmentInput,
  parseRubric,
  rubricScore,
  safeFileSlug,
  validateSubmissionFile,
  type Rubric,
} from "./assignment";

const RUBRIC: Rubric = {
  criteria: [
    {
      id: "c1",
      title: "Claridad",
      levels: [
        { id: "l1", label: "Insuficiente", points: 0 },
        { id: "l2", label: "Suficiente", points: 2 },
        { id: "l3", label: "Excelente", points: 4 },
      ],
    },
    {
      id: "c2",
      title: "Profundidad",
      levels: [
        { id: "l1", label: "No", points: 0 },
        { id: "l2", label: "Sí", points: 6 },
      ],
    },
  ],
};

describe("parseRubric (S8)", () => {
  it("null/vacío → rúbrica nula (nota directa)", () => {
    expect(parseRubric(null)).toEqual({ ok: true, value: null });
    expect(parseRubric("")).toEqual({ ok: true, value: null });
  });

  it("rúbrica válida", () => {
    const r = parseRubric(RUBRIC);
    expect(r.ok).toBe(true);
  });

  it("criterio con <2 niveles o sin título → error", () => {
    const r = parseRubric({ criteria: [{ title: "", levels: [{ label: "x", points: 1 }] }] });
    expect(r.ok).toBe(false);
  });
});

describe("rubricScore (S8/S1)", () => {
  it("suma los niveles elegidos y convierte a nota", () => {
    const r = rubricScore(RUBRIC, { c1: "l3", c2: "l2" }, 60); // 4 + 6 = 10/10
    expect(r).toMatchObject({ points: 10, maxPoints: 10, grade: 7.0 });
  });

  it("criterio sin elegir cuenta 0", () => {
    const r = rubricScore(RUBRIC, { c1: "l2" }, 60); // 2/10
    expect(r.points).toBe(2);
    expect(r.grade).toBeLessThan(4);
  });
});

describe("lateness (S9)", () => {
  const due = "2026-08-01T12:00:00Z";
  it("a tiempo, tardía dentro de la gracia, rechazada después", () => {
    expect(lateness(due, 24, Date.parse("2026-08-01T10:00:00Z"))).toBe("on_time");
    expect(lateness(due, 24, Date.parse("2026-08-02T10:00:00Z"))).toBe("late");
    expect(lateness(due, 24, Date.parse("2026-08-03T13:00:00Z"))).toBe("rejected");
  });
  it("sin plazo siempre a tiempo; gracia 0 no tolera nada", () => {
    expect(lateness(null, 0, Date.now())).toBe("on_time");
    expect(lateness(due, 0, Date.parse("2026-08-01T12:00:01Z"))).toBe("rejected");
  });
});

describe("validateSubmissionFile + safeFileSlug", () => {
  it("acepta PDF pequeño, rechaza vacío, grande y tipo no permitido", () => {
    expect(validateSubmissionFile({ name: "t.pdf", size: 1000, type: "application/pdf" })).toEqual({
      ok: true,
    });
    expect(validateSubmissionFile({ name: "t", size: 0, type: "application/pdf" }).ok).toBe(false);
    expect(
      validateSubmissionFile({ name: "t.pdf", size: 21 * 1024 * 1024, type: "application/pdf" }).ok,
    ).toBe(false);
    expect(
      validateSubmissionFile({ name: "t.exe", size: 10, type: "application/x-msdownload" }).ok,
    ).toBe(false);
  });

  it("safeFileSlug limpia acentos y caracteres raros", () => {
    expect(safeFileSlug("Tarea Final Ñoño (v2).pdf")).toBe("Tarea_Final_Nono_v2_.pdf");
    expect(safeFileSlug("")).toBe("archivo");
  });
});

describe("parseAssignmentInput", () => {
  it("válido con nota directa (sin rúbrica)", () => {
    const r = parseAssignmentInput({ title: "Informe", graceHours: 24 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rubric).toBeNull();
      expect(r.value.graceHours).toBe(24);
    }
  });

  it("acumula errores de campos inválidos", () => {
    const r = parseAssignmentInput({ title: "", graceHours: 999, passingPct: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.field).sort()).toEqual(["graceHours", "passingPct", "title"]);
    }
  });
});
