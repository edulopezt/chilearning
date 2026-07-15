import { describe, expect, it } from "vitest";

import { normalizeCompletionRules, parseCourseInput } from "./course";

const base = {
  name: "Prevención de riesgos",
  modality: "elearning",
  hours: "10",
  sence: "true",
  codSence: "1234567890",
  status: "draft",
};

describe("parseCourseInput", () => {
  it("acepta un curso SENCE válido y normaliza tipos", () => {
    const r = parseCourseInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({
        name: "Prevención de riesgos",
        modality: "elearning",
        hours: 10,
        sence: true,
        codSence: "1234567890",
        status: "draft",
      });
    }
  });

  it("exige nombre", () => {
    const r = parseCourseInput({ ...base, name: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.field).toBe("name");
  });

  it("rechaza modalidad inválida", () => {
    const r = parseCourseInput({ ...base, modality: "hibrido" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === "modality")).toBe(true);
  });

  it("rechaza horas no enteras o negativas", () => {
    expect(parseCourseInput({ ...base, hours: "-5" }).ok).toBe(false);
    expect(parseCourseInput({ ...base, hours: "3.5" }).ok).toBe(false);
    expect(parseCourseInput({ ...base, hours: "abc" }).ok).toBe(false);
  });

  it("un curso SENCE exige CodSence de 10 dígitos", () => {
    const r = parseCourseInput({ ...base, codSence: "123" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === "codSence")).toBe(true);
  });

  it("un curso NO SENCE descarta el código", () => {
    const r = parseCourseInput({ ...base, sence: "false", codSence: "1234567890" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.sence).toBe(false);
      expect(r.value.codSence).toBeNull();
    }
  });

  it("permite curso SENCE sin código (línea 1, va en la acción)", () => {
    const r = parseCourseInput({ ...base, codSence: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.codSence).toBeNull();
  });
});

describe("normalizeCompletionRules", () => {
  it("acota el porcentaje a 0–100 y redondea", () => {
    expect(normalizeCompletionRules({ minAttendancePct: 150 }).minAttendancePct).toBe(100);
    expect(normalizeCompletionRules({ minAttendancePct: -5 }).minAttendancePct).toBe(0);
    expect(normalizeCompletionRules({ minAttendancePct: 74.6 }).minAttendancePct).toBe(75);
  });

  it("interpreta banderas booleanas desde form (on/true/1)", () => {
    const r = normalizeCompletionRules({ requireAllLessons: "on", requireSurvey: "1" });
    expect(r).toEqual({ requireAllLessons: true, requireSurvey: true, minAttendancePct: 0 });
  });

  it("usa defaults con entrada basura", () => {
    expect(normalizeCompletionRules(null)).toEqual({
      requireAllLessons: true,
      requireSurvey: false,
      minAttendancePct: 0,
    });
  });
});
