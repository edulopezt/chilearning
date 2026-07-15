import { describe, expect, it } from "vitest";

import { parseActionInput } from "./action";

const base = {
  courseId: "c0000000-0000-4000-8000-000000000001",
  codigoAccion: "ACC-2026-001",
  trainingLine: "3",
  environment: "rcetest",
  attendanceLock: "true",
  startsOn: "2026-08-01",
  endsOn: "2026-08-31",
};

describe("parseActionInput", () => {
  it("acepta una acción válida y normaliza tipos", () => {
    const r = parseActionInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({
        codigoAccion: "ACC-2026-001",
        trainingLine: 3,
        environment: "rcetest",
        attendanceLock: true,
        startsOn: "2026-08-01",
        endsOn: "2026-08-31",
      });
    }
  });

  it("exige curso", () => {
    const r = parseActionInput({ ...base, courseId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.field).toBe("courseId");
  });

  it("rechaza líneas de capacitación fuera de {1,3,6}", () => {
    expect(parseActionInput({ ...base, trainingLine: "2" }).ok).toBe(false);
    expect(parseActionInput({ ...base, trainingLine: "1" }).ok).toBe(true);
    expect(parseActionInput({ ...base, trainingLine: "6" }).ok).toBe(true);
  });

  it("permite el comodín -1 en rcetest", () => {
    const r = parseActionInput({ ...base, codigoAccion: "-1", environment: "rcetest" });
    expect(r.ok).toBe(true);
  });

  it("RECHAZA el comodín -1 en producción (rce) — I-8", () => {
    const r = parseActionInput({ ...base, codigoAccion: "-1", environment: "rce" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === "codigoAccion")).toBe(true);
  });

  it("rechaza fecha de inicio posterior a la de término", () => {
    const r = parseActionInput({ ...base, startsOn: "2026-09-01", endsOn: "2026-08-01" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === "dates")).toBe(true);
  });

  it("permite acción sin fechas (opcionales)", () => {
    const r = parseActionInput({ ...base, startsOn: "", endsOn: "" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.startsOn).toBeNull();
      expect(r.value.endsOn).toBeNull();
    }
  });

  it("rechaza ambiente inválido", () => {
    const r = parseActionInput({ ...base, environment: "produccion" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === "environment")).toBe(true);
  });
});
