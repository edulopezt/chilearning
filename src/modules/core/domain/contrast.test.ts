import { describe, expect, it } from "vitest";

import { bestTextOn, checkBrandColor, contrastRatio, parseHex } from "./contrast";

describe("parseHex", () => {
  it("parsea con y sin # y rechaza inválidos", () => {
    expect(parseHex("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHex("#abc")).toBeNull();
    expect(parseHex("nope")).toBeNull();
  });
});

describe("contrastRatio (valores canónicos WCAG)", () => {
  it("negro sobre blanco = 21", () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 1);
  });
  it("blanco sobre blanco = 1", () => {
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });
  it("es simétrica", () => {
    const a = { r: 30, g: 100, b: 200 };
    const b = { r: 240, g: 240, b: 240 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 5);
  });
});

describe("bestTextOn", () => {
  it("elige texto blanco sobre un azul oscuro", () => {
    expect(bestTextOn({ r: 20, g: 40, b: 120 }).text).toBe("#ffffff");
  });
  it("elige texto negro sobre un amarillo claro", () => {
    expect(bestTextOn({ r: 250, g: 240, b: 80 }).text).toBe("#000000");
  });
});

describe("checkBrandColor", () => {
  it("un azul oscuro cumple AA (texto blanco legible sobre el botón)", () => {
    const r = checkBrandColor("#1e3a8a");
    expect(r?.ok).toBe(true);
    expect(r?.suggestion).toBeNull();
    expect(r!.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("un amarillo brillante NO cumple (texto blanco ilegible) y propone un ajuste que sí", () => {
    const r = checkBrandColor("#ffe000");
    expect(r?.ok).toBe(false);
    expect(r?.suggestion).not.toBeNull();
    const adjusted = checkBrandColor(r!.suggestion!);
    expect(adjusted?.ok).toBe(true);
    expect(adjusted!.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("un celeste claro NO cumple y su ajuste sí", () => {
    const r = checkBrandColor("#7dd3fc");
    expect(r?.ok).toBe(false);
    expect(checkBrandColor(r!.suggestion!)?.ok).toBe(true);
  });

  it("devuelve null para un hex inválido", () => {
    expect(checkBrandColor("rojo")).toBeNull();
  });
});
