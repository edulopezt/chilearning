import { describe, expect, it } from "vitest";

import { validateGradeChange } from "./grade-change";

describe("validateGradeChange (D-022 §S11 — gate de auditoría)", () => {
  it("draft se edita libre y no exige auditoría", () => {
    const r = validateGradeChange({
      currentStatus: "draft",
      nextGrade: 5.5,
      nextFeedback: "",
      motivo: null,
    });
    expect(r).toEqual({ ok: true, requiresAudit: false });
  });

  it("PUBLICADA sin motivo → validation error (el gate del hito)", () => {
    const r = validateGradeChange({
      currentStatus: "published",
      nextGrade: 6.0,
      nextFeedback: "",
      motivo: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.field).toBe("motivo");
  });

  it("PUBLICADA con motivo → ok y requiresAudit", () => {
    const r = validateGradeChange({
      currentStatus: "published",
      nextGrade: 6.0,
      nextFeedback: "corrección de pauta",
      motivo: "Error de digitación en la pauta original",
    });
    expect(r).toEqual({ ok: true, requiresAudit: true });
  });

  it("nota fuera de rango o con más de un decimal → error", () => {
    expect(
      validateGradeChange({ currentStatus: "draft", nextGrade: 7.5, nextFeedback: "", motivo: null })
        .ok,
    ).toBe(false);
    expect(
      validateGradeChange({ currentStatus: "draft", nextGrade: 5.55, nextFeedback: "", motivo: null })
        .ok,
    ).toBe(false);
  });
});
