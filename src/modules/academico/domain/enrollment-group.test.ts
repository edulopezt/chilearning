import { describe, expect, it } from "vitest";

import { BECARIO_LABEL, enrollmentGroupLabel, parseGrupo } from "./enrollment-group";

describe("parseGrupo (HU-2.2 — grupos operativos del OTEC)", () => {
  it("celda vacía o ausente → none (decide la columna exento)", () => {
    expect(parseGrupo("")).toEqual({ kind: "none" });
    expect(parseGrupo("   ")).toEqual({ kind: "none" });
    expect(parseGrupo(undefined)).toEqual({ kind: "none" });
  });

  it("Becario en cualquier capitalización y con espacios", () => {
    expect(parseGrupo("Becario")).toEqual({ kind: "becario" });
    expect(parseGrupo("BECARIO")).toEqual({ kind: "becario" });
    expect(parseGrupo("  becario ")).toEqual({ kind: "becario" });
  });

  it("Sence-<código> extrae el código (insensible a mayúsculas)", () => {
    expect(parseGrupo("Sence-6721201")).toEqual({ kind: "sence", code: "6721201" });
    expect(parseGrupo("SENCE-1237994584")).toEqual({ kind: "sence", code: "1237994584" });
    expect(parseGrupo(" sence-42 ")).toEqual({ kind: "sence", code: "42" });
  });

  it("valores no reconocidos → invalid (nunca se adivina)", () => {
    expect(parseGrupo("Sence-")).toEqual({ kind: "invalid" });
    expect(parseGrupo("Sence-abc")).toEqual({ kind: "invalid" });
    expect(parseGrupo("Sence 6721201")).toEqual({ kind: "invalid" }); // sin guión
    expect(parseGrupo("Sence-12345678901")).toEqual({ kind: "invalid" }); // >10 dígitos
    expect(parseGrupo("Grupo A")).toEqual({ kind: "invalid" });
  });
});

describe("enrollmentGroupLabel", () => {
  it("exento → Becario, incluso si el curso tiene código", () => {
    expect(enrollmentGroupLabel(true, "6721201")).toBe(BECARIO_LABEL);
    expect(enrollmentGroupLabel(true, null)).toBe(BECARIO_LABEL);
  });

  it("no exento con código → Sence-<código>; sin código → null", () => {
    expect(enrollmentGroupLabel(false, "6721201")).toBe("Sence-6721201");
    expect(enrollmentGroupLabel(false, null)).toBeNull();
  });
});
