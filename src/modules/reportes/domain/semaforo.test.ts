import { describe, expect, it } from "vitest";

import { semaforo } from "./semaforo";

describe("semaforo", () => {
  it("sin inscritos → rojo", () => {
    expect(semaforo({ enrolled: 0, avgProgressPct: 100, attendanceRatePct: 100, requiresAttendance: true }).color).toBe("red");
  });

  it("con candado pondera avance y asistencia por igual", () => {
    // 80% avance + 80% asistencia → 80 → verde
    expect(semaforo({ enrolled: 10, avgProgressPct: 80, attendanceRatePct: 80, requiresAttendance: true })).toEqual({ color: "green", score: 80 });
    // 80% avance pero 20% asistencia → 50 → amarillo (la asistencia baja penaliza)
    expect(semaforo({ enrolled: 10, avgProgressPct: 80, attendanceRatePct: 20, requiresAttendance: true })).toEqual({ color: "yellow", score: 50 });
  });

  it("sin candado solo mira el avance", () => {
    expect(semaforo({ enrolled: 5, avgProgressPct: 90, attendanceRatePct: 0, requiresAttendance: false })).toEqual({ color: "green", score: 90 });
  });

  it("poco avance → rojo", () => {
    expect(semaforo({ enrolled: 8, avgProgressPct: 10, attendanceRatePct: 10, requiresAttendance: true }).color).toBe("red");
  });

  it("umbrales verde ≥67, amarillo ≥34, rojo <34", () => {
    expect(semaforo({ enrolled: 1, avgProgressPct: 67, attendanceRatePct: 67, requiresAttendance: false }).color).toBe("green");
    expect(semaforo({ enrolled: 1, avgProgressPct: 34, attendanceRatePct: 0, requiresAttendance: false }).color).toBe("yellow");
    expect(semaforo({ enrolled: 1, avgProgressPct: 33, attendanceRatePct: 0, requiresAttendance: false }).color).toBe("red");
  });

  it("acota valores fuera de rango", () => {
    expect(semaforo({ enrolled: 1, avgProgressPct: 150, attendanceRatePct: -10, requiresAttendance: false }).score).toBe(100);
  });
});
