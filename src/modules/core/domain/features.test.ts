import { describe, expect, it } from "vitest";

import {
  FEATURE_KEYS,
  flagsUpdateSchema,
  isFeatureEnabled,
} from "@/modules/core/domain/features";

describe("isFeatureEnabled (deny-by-default, P7)", () => {
  it("flags null / undefined / string / array / número => false", () => {
    expect(isFeatureEnabled(null, "scorm")).toBe(false);
    expect(isFeatureEnabled(undefined, "scorm")).toBe(false);
    expect(isFeatureEnabled("scorm", "scorm")).toBe(false);
    expect(isFeatureEnabled(["scorm"], "scorm")).toBe(false);
    expect(isFeatureEnabled(42, "scorm")).toBe(false);
  });

  it("clave ausente => false", () => {
    expect(isFeatureEnabled({}, "scorm")).toBe(false);
    expect(isFeatureEnabled({ ai_tutor: true }, "scorm")).toBe(false);
  });

  it('{"scorm":"true"} (string, no booleano) => false', () => {
    expect(isFeatureEnabled({ scorm: "true" }, "scorm")).toBe(false);
  });

  it("SOLO el booleano true habilita", () => {
    expect(isFeatureEnabled({ scorm: true }, "scorm")).toBe(true);
    expect(isFeatureEnabled({ scorm: false }, "scorm")).toBe(false);
    expect(isFeatureEnabled({ scorm: 1 }, "scorm")).toBe(false);
  });

  it("cada clave del contrato funciona de forma independiente", () => {
    for (const key of FEATURE_KEYS) {
      expect(isFeatureEnabled({ [key]: true }, key)).toBe(true);
      expect(isFeatureEnabled({}, key)).toBe(false);
    }
  });
});

describe("flagsUpdateSchema (borde Zod)", () => {
  it("acepta actualizaciones parciales de claves conocidas", () => {
    expect(flagsUpdateSchema.safeParse({ scorm: true }).success).toBe(true);
    expect(flagsUpdateSchema.safeParse({ ai_tutor: false, whatsapp: true }).success).toBe(true);
    expect(flagsUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("rechaza valores no booleanos", () => {
    expect(flagsUpdateSchema.safeParse({ scorm: "true" }).success).toBe(false);
    expect(flagsUpdateSchema.safeParse({ scorm: 1 }).success).toBe(false);
  });

  it("rechaza claves desconocidas y entradas no-objeto", () => {
    expect(flagsUpdateSchema.safeParse({ video: true }).success).toBe(false);
    expect(flagsUpdateSchema.safeParse(null).success).toBe(false);
    expect(flagsUpdateSchema.safeParse([true]).success).toBe(false);
  });
});
