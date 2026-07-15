import { describe, expect, it } from "vitest";

import { chileanGrade, isPassing } from "./scale";

describe("chileanGrade (D-022 §S1 — escala 1.0–7.0 con exigencia)", () => {
  it("tabla de casos con exigencia 60%", () => {
    // [score, max, esperado]
    const cases: [number, number, number][] = [
      [0, 100, 1.0],
      [30, 100, 2.5], // 1 + 3·(30/60)
      [60, 100, 4.0], // exigencia exacta → aprobación
      [80, 100, 5.5], // 4 + 3·(20/40)
      [100, 100, 7.0],
    ];
    for (const [score, max, expected] of cases) {
      expect(chileanGrade(score, max, 60), `${score}/${max}`).toBe(expected);
    }
  });

  it("exigencia configurable: 50% y 70% mueven el 4.0", () => {
    expect(chileanGrade(50, 100, 50)).toBe(4.0);
    expect(chileanGrade(70, 100, 70)).toBe(4.0);
    expect(chileanGrade(35, 100, 70)).toBe(2.5);
  });

  it("redondeo a 1 decimal y clamp", () => {
    expect(chileanGrade(33, 100, 60)).toBe(2.7); // 2.65 → 2.7 (round half up)
    expect(chileanGrade(-5, 100, 60)).toBe(1.0);
    expect(chileanGrade(200, 100, 60)).toBe(7.0);
  });

  it("defensivo: max inválido o exigencia rara no lanzan", () => {
    expect(chileanGrade(10, 0, 60)).toBe(1.0);
    expect(chileanGrade(10, Number.NaN, 60)).toBe(1.0);
    expect(chileanGrade(50, 100, 999)).toBeGreaterThanOrEqual(1.0);
  });
});

describe("isPassing (S13)", () => {
  it("default 4.0; umbral configurable", () => {
    expect(isPassing(4.0)).toBe(true);
    expect(isPassing(3.9)).toBe(false);
    expect(isPassing(5.0, 5.5)).toBe(false);
  });
});
