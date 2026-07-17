import { describe, expect, it } from "vitest";

import { extractCmiSignals, MAX_CMI_BYTES } from "./cmi";

describe("extractCmiSignals (task 5.1b, HU-4.2)", () => {
  it("MAX_CMI_BYTES espeja el CHECK de 256 KB de la migración scorm_cmi", () => {
    expect(MAX_CMI_BYTES).toBe(262144);
  });

  describe("SCORM 1.2", () => {
    it("lesson_status=completed → completed=true", () => {
      const result = extractCmiSignals("1.2", { core: { lesson_status: "completed" } });
      expect(result).toEqual({ completed: true, scoreRaw: null, lessonStatus: "completed" });
    });

    it("lesson_status=passed → completed=true (equivalente a completed para efectos de progreso)", () => {
      const result = extractCmiSignals("1.2", { core: { lesson_status: "passed" } });
      expect(result.completed).toBe(true);
      expect(result.lessonStatus).toBe("passed");
    });

    it("lesson_status=incomplete → completed=false", () => {
      const result = extractCmiSignals("1.2", { core: { lesson_status: "incomplete" } });
      expect(result).toEqual({ completed: false, scoreRaw: null, lessonStatus: "incomplete" });
    });

    it("lesson_status=failed → completed=false", () => {
      const result = extractCmiSignals("1.2", { core: { lesson_status: "failed" } });
      expect(result.completed).toBe(false);
      expect(result.lessonStatus).toBe("failed");
    });

    it("score.raw numérico se lee tal cual", () => {
      const result = extractCmiSignals("1.2", { core: { lesson_status: "completed", score: { raw: 85 } } });
      expect(result.scoreRaw).toBe(85);
    });

    it("score.raw como string numérica (lo que realmente manda el runtime SCORM) se parsea", () => {
      const result = extractCmiSignals("1.2", { core: { lesson_status: "completed", score: { raw: "72.5" } } });
      expect(result.scoreRaw).toBe(72.5);
    });

    it("score ausente → scoreRaw null", () => {
      const result = extractCmiSignals("1.2", { core: { lesson_status: "completed" } });
      expect(result.scoreRaw).toBeNull();
    });

    it("score.raw no parseable (string vacía o basura) → scoreRaw null, no lanza", () => {
      expect(extractCmiSignals("1.2", { core: { score: { raw: "" } } }).scoreRaw).toBeNull();
      expect(extractCmiSignals("1.2", { core: { score: { raw: "no-es-numero" } } }).scoreRaw).toBeNull();
      expect(extractCmiSignals("1.2", { core: { score: { raw: Number.NaN } } }).scoreRaw).toBeNull();
      expect(extractCmiSignals("1.2", { core: { score: { raw: Number.POSITIVE_INFINITY } } }).scoreRaw).toBeNull();
    });

    it("core ausente → valores por defecto", () => {
      expect(extractCmiSignals("1.2", {})).toEqual({ completed: false, scoreRaw: null, lessonStatus: null });
    });

    it("core no es un objeto (string/número/array) → valores por defecto, no lanza", () => {
      expect(extractCmiSignals("1.2", { core: "no-es-objeto" }).lessonStatus).toBeNull();
      expect(extractCmiSignals("1.2", { core: 42 }).lessonStatus).toBeNull();
      expect(extractCmiSignals("1.2", { core: [1, 2, 3] }).lessonStatus).toBeNull();
    });

    it("score no es un objeto → scoreRaw null", () => {
      expect(extractCmiSignals("1.2", { core: { score: "no-es-objeto" } }).scoreRaw).toBeNull();
      expect(extractCmiSignals("1.2", { core: { score: null } }).scoreRaw).toBeNull();
    });

    it("lesson_status no-string (número/objeto) → lessonStatus null, no lanza", () => {
      expect(extractCmiSignals("1.2", { core: { lesson_status: 1 } }).lessonStatus).toBeNull();
      expect(extractCmiSignals("1.2", { core: { lesson_status: { x: 1 } } }).lessonStatus).toBeNull();
    });
  });

  describe("SCORM 2004", () => {
    it("completion_status=completed → completed=true", () => {
      const result = extractCmiSignals("2004", { completion_status: "completed" });
      expect(result.completed).toBe(true);
      expect(result.lessonStatus).toBe("completed");
    });

    it("success_status=passed → completed=true (aunque completion_status sea incomplete)", () => {
      const result = extractCmiSignals("2004", { completion_status: "incomplete", success_status: "passed" });
      expect(result.completed).toBe(true);
      // success_status manda sobre completion_status para el estado normalizado.
      expect(result.lessonStatus).toBe("passed");
    });

    it("completion_status=incomplete y success_status=unknown → completed=false", () => {
      const result = extractCmiSignals("2004", { completion_status: "incomplete", success_status: "unknown" });
      expect(result.completed).toBe(false);
      expect(result.lessonStatus).toBe("incomplete");
    });

    it("success_status=failed → completed=false, lessonStatus=failed", () => {
      const result = extractCmiSignals("2004", { completion_status: "completed", success_status: "failed" });
      // completed=true igual porque completion_status=completed también cuenta
      // como "terminó el intento" (independiente de si aprobó o no).
      expect(result.completed).toBe(true);
      expect(result.lessonStatus).toBe("failed");
    });

    it("score.raw presente se usa directo, ignora scaled", () => {
      const result = extractCmiSignals("2004", { score: { raw: 90, scaled: 0.5 } });
      expect(result.scoreRaw).toBe(90);
    });

    it("sin score.raw pero con score.scaled entre 0 y 1 → normaliza a 0-100", () => {
      const result = extractCmiSignals("2004", { score: { scaled: 0.85 } });
      expect(result.scoreRaw).toBe(85);
    });

    it("score.scaled fuera de rango (negativo o > 1) → no lo usa, scoreRaw null", () => {
      expect(extractCmiSignals("2004", { score: { scaled: -0.2 } }).scoreRaw).toBeNull();
      expect(extractCmiSignals("2004", { score: { scaled: 1.2 } }).scoreRaw).toBeNull();
    });

    it("sin score.raw ni score.scaled → scoreRaw null", () => {
      expect(extractCmiSignals("2004", { completion_status: "completed" }).scoreRaw).toBeNull();
    });

    it("ni completion_status ni success_status → valores por defecto", () => {
      expect(extractCmiSignals("2004", {})).toEqual({ completed: false, scoreRaw: null, lessonStatus: null });
    });
  });

  describe("tolerancia ante basura (cmi no confiable, nunca debe lanzar)", () => {
    it("cmi=null", () => {
      expect(extractCmiSignals("1.2", null)).toEqual({ completed: false, scoreRaw: null, lessonStatus: null });
      expect(extractCmiSignals("2004", null)).toEqual({ completed: false, scoreRaw: null, lessonStatus: null });
    });

    it("cmi=undefined", () => {
      expect(extractCmiSignals("1.2", undefined)).toEqual({ completed: false, scoreRaw: null, lessonStatus: null });
    });

    it("cmi=string", () => {
      expect(extractCmiSignals("1.2", "no-es-un-objeto")).toEqual({
        completed: false,
        scoreRaw: null,
        lessonStatus: null,
      });
    });

    it("cmi=número", () => {
      expect(extractCmiSignals("2004", 42)).toEqual({ completed: false, scoreRaw: null, lessonStatus: null });
    });

    it("cmi=array", () => {
      expect(extractCmiSignals("1.2", [1, 2, 3])).toEqual({ completed: false, scoreRaw: null, lessonStatus: null });
      expect(extractCmiSignals("2004", ["a", "b"])).toEqual({ completed: false, scoreRaw: null, lessonStatus: null });
    });

    it("cmi=boolean", () => {
      expect(extractCmiSignals("1.2", true)).toEqual({ completed: false, scoreRaw: null, lessonStatus: null });
    });

    it("estructuras profundamente anidadas e incompletas no lanzan", () => {
      expect(() => extractCmiSignals("1.2", { core: { score: {} } })).not.toThrow();
      expect(() => extractCmiSignals("2004", { score: {} })).not.toThrow();
      expect(() => extractCmiSignals("1.2", { core: null })).not.toThrow();
      expect(() => extractCmiSignals("2004", { completion_status: 123, success_status: [] })).not.toThrow();
      expect(() => extractCmiSignals("1.2", { core: { lesson_status: "completed", score: { raw: {} } } })).not.toThrow();
    });
  });
});
