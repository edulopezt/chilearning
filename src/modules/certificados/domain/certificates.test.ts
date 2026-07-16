import { describe, expect, it } from "vitest";

import { attendancePctFromCells } from "./attendance";
import { evaluateEligibility, type CompletionFacts, type EligibilityRules } from "./eligibility";
import { formatFolio, maskRun } from "./folio";
import { buildCertificateSnapshot } from "./snapshot";

const RULES: EligibilityRules = {
  requireAllLessons: true,
  requireSurvey: true,
  minGrade: 4.0,
  minAttendancePct: 75,
  isSence: true,
};

const OK: CompletionFacts = {
  allLessonsDone: true,
  finalGrade: 6.0,
  surveyDone: true,
  attendancePct: 90,
  exento: false,
};

describe("evaluateEligibility", () => {
  it("elegible cuando cumple todo", () => {
    expect(evaluateEligibility(RULES, OK)).toEqual({ eligible: true, reasons: [] });
  });

  it("bloquea por lecciones incompletas", () => {
    const r = evaluateEligibility(RULES, { ...OK, allLessonsDone: false });
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("lessons_incomplete");
  });

  it("bloquea por nota bajo el mínimo (si existe nota)", () => {
    const r = evaluateEligibility(RULES, { ...OK, finalGrade: 3.5 });
    expect(r.reasons).toContain("grade_below_min");
  });

  it("NO bloquea por nota si no hay instrumentos calificados (finalGrade null)", () => {
    const r = evaluateEligibility(RULES, { ...OK, finalGrade: null });
    expect(r.reasons).not.toContain("grade_below_min");
  });

  it("bloquea por encuesta pendiente", () => {
    const r = evaluateEligibility(RULES, { ...OK, surveyDone: false });
    expect(r.reasons).toContain("survey_pending");
  });

  it("bloquea por asistencia bajo el umbral (SENCE, no exento)", () => {
    const r = evaluateEligibility(RULES, { ...OK, attendancePct: 50 });
    expect(r.reasons).toContain("attendance_below_min");
  });

  it("el exento NO tiene gate de asistencia", () => {
    const r = evaluateEligibility(RULES, { ...OK, exento: true, attendancePct: 0 });
    expect(r.reasons).not.toContain("attendance_below_min");
  });

  it("sin gate de asistencia si el curso no es SENCE o umbral 0", () => {
    expect(evaluateEligibility({ ...RULES, isSence: false }, { ...OK, attendancePct: 10 }).reasons).not.toContain("attendance_below_min");
    expect(evaluateEligibility({ ...RULES, minAttendancePct: 0 }, { ...OK, attendancePct: 10 }).reasons).not.toContain("attendance_below_min");
  });
});

describe("folio + maskRun", () => {
  it("formatFolio rellena a 6 dígitos", () => {
    expect(formatFolio(2026, 7)).toBe("CERT-2026-000007");
    expect(formatFolio(2026, 123456)).toBe("CERT-2026-123456");
  });

  it("maskRun oculta todo menos los primeros 2 dígitos", () => {
    expect(maskRun("12.345.678-9")).toBe("12.XXX.XXX-X");
    expect(maskRun("5126663-3")).toBe("51.XXX.XXX-X");
    expect(maskRun("9-9")).toBe("XXX-X");
  });
});

describe("attendancePctFromCells", () => {
  it("cuenta días cerrados sobre el total de días hábiles", () => {
    expect(
      attendancePctFromCells([
        { status: "cerrada" },
        { status: "cerrada" },
        { status: "none" },
        { status: "error" },
      ]),
    ).toBe(50);
    expect(attendancePctFromCells([])).toBe(0);
  });
});

describe("buildCertificateSnapshot", () => {
  it("congela el set §7-R7 y deriva el RUN enmascarado", () => {
    const snap = buildCertificateSnapshot({
      studentName: "Ana Díaz",
      run: "12.345.678-9",
      courseName: "Prevención de riesgos",
      hours: 40,
      startsOn: "2026-07-01",
      endsOn: "2026-07-31",
      finalGrade: 6.5,
      codSence: "1234567890",
      actionCode: "ACC-1",
      attendancePct: 90,
      otecName: "OTEC Demo",
      otecRut: "76.111.111-6",
      brandPrimary: "#1e3a8a",
      brandAccent: "#0ea5e9",
      logoUrl: null,
      isSence: true,
      issuedAtISO: "2026-07-16T12:00:00.000Z",
    });
    expect(snap.runMasked).toBe("12.XXX.XXX-X");
    expect(snap.run).toBe("12.345.678-9");
    expect(snap.courseName).toBe("Prevención de riesgos");
  });
});
