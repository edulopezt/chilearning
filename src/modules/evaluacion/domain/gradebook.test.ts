import { describe, expect, it } from "vitest";

import {
  consolidate,
  gradebookToCsv,
  rowStatus,
  type CsvLabels,
  type GradebookInstrument,
  type GradebookStudent,
} from "./gradebook";

const quiz: GradebookInstrument = { id: "q1", kind: "quiz", title: "Quiz 1", weight: 1 };
const tarea: GradebookInstrument = { id: "a1", kind: "assignment", title: "Tarea 1", weight: 3 };

function student(id: string, name: string, grades: Record<string, number>): GradebookStudent {
  return { enrollmentId: id, name, run: "5126663-3", grades: new Map(Object.entries(grades)) };
}

describe("consolidate — promedio ponderado parcial (S10)", () => {
  it("promedia ponderando por el peso de cada instrumento (completo)", () => {
    const gb = consolidate([quiz, tarea], [student("e1", "Ana", { q1: 5.0, a1: 7.0 })]);
    // (5·1 + 7·3) / (1+3) = 26/4 = 6.5
    expect(gb.rows[0]!.finalGrade).toBe(6.5);
    expect(gb.rows[0]!.incomplete).toBe(false);
    expect(gb.rows[0]!.passed).toBe(true);
  });

  it("promedio PARCIAL sobre lo calificado + marca incompleta si falta un instrumento", () => {
    const gb = consolidate([quiz, tarea], [student("e1", "Ana", { a1: 4.0 })]);
    // Solo la tarea está calificada: promedio parcial = 4.0, incompleta.
    expect(gb.rows[0]!.finalGrade).toBe(4.0);
    expect(gb.rows[0]!.incomplete).toBe(true);
    // La aprobación FINAL no se decide con el libro incompleto.
    expect(gb.rows[0]!.passed).toBeNull();
  });

  it("no cuenta los instrumentos faltantes como 1.0 (decisión de Edu)", () => {
    const gb = consolidate([quiz, tarea], [student("e1", "Ana", { q1: 6.0 })]);
    // Si contara la tarea faltante como 1.0 → (6·1+1·3)/4 = 2.25. Parcial = 6.0.
    expect(gb.rows[0]!.finalGrade).toBe(6.0);
  });

  it("completo bajo el umbral → reprobado", () => {
    const gb = consolidate([quiz, tarea], [student("e1", "Ana", { q1: 3.0, a1: 3.0 })]);
    expect(gb.rows[0]!.finalGrade).toBe(3.0);
    expect(gb.rows[0]!.incomplete).toBe(false);
    expect(gb.rows[0]!.passed).toBe(false);
  });

  it("sin ninguna nota → final null, incompleta, passed null", () => {
    const gb = consolidate([quiz, tarea], [student("e1", "Ana", {})]);
    expect(gb.rows[0]!.finalGrade).toBeNull();
    expect(gb.rows[0]!.incomplete).toBe(true);
    expect(gb.rows[0]!.passed).toBeNull();
    expect(gb.rows[0]!.cells).toEqual([
      { instrumentId: "q1", grade: null },
      { instrumentId: "a1", grade: null },
    ]);
  });

  it("sin instrumentos → no hay nada que promediar (final null, no incompleta)", () => {
    const gb = consolidate([], [student("e1", "Ana", {})]);
    expect(gb.rows[0]!.finalGrade).toBeNull();
    expect(gb.rows[0]!.incomplete).toBe(false);
    expect(gb.rows[0]!.passed).toBeNull();
  });

  it("peso 0 no rompe (no divide por cero)", () => {
    const zero: GradebookInstrument = { id: "z", kind: "quiz", title: "Diagnóstico", weight: 0 };
    const gb = consolidate([zero], [student("e1", "Ana", { z: 7.0 })]);
    // Único instrumento con peso 0 → suma de pesos 0 → sin promedio.
    expect(gb.rows[0]!.finalGrade).toBeNull();
    expect(gb.rows[0]!.incomplete).toBe(false); // está calificado, no falta nada
  });

  it("acota notas fuera de rango (defensivo)", () => {
    const gb = consolidate([quiz], [student("e1", "Ana", { q1: 9.9 })]);
    expect(gb.rows[0]!.finalGrade).toBe(7.0);
  });

  it("respeta el umbral configurable de aprobación", () => {
    const gb = consolidate([quiz], [student("e1", "Ana", { q1: 5.0 })], 5.5);
    expect(gb.rows[0]!.passed).toBe(false);
  });
});

describe("rowStatus", () => {
  it("distingue sin-notas / incompleta / aprobado / reprobado", () => {
    expect(rowStatus(consolidate([quiz, tarea], [student("e", "A", {})]).rows[0]!)).toBe("none");
    expect(rowStatus(consolidate([quiz, tarea], [student("e", "A", { q1: 6 })]).rows[0]!)).toBe("incomplete");
    expect(rowStatus(consolidate([quiz], [student("e", "A", { q1: 6 })]).rows[0]!)).toBe("passed");
    expect(rowStatus(consolidate([quiz], [student("e", "A", { q1: 2 })]).rows[0]!)).toBe("failed");
  });
});

describe("gradebookToCsv", () => {
  const labels: CsvLabels = {
    student: "Alumno",
    run: "RUN",
    finalGrade: "Nota final",
    status: "Estado",
    statusPassed: "Aprobado",
    statusFailed: "Reprobado",
    statusIncomplete: "Incompleta",
    statusNoGrades: "Sin notas",
  };

  it("BOM + separador ; + encabezados con títulos de instrumentos", () => {
    const gb = consolidate([quiz, tarea], [student("e1", "Ana Díaz", { q1: 5.0, a1: 7.0 })]);
    const csv = gradebookToCsv(gb, labels);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(lines[0]).toBe("Alumno;RUN;Quiz 1;Tarea 1;Nota final;Estado");
    expect(lines[1]).toBe("Ana Díaz;5126663-3;5.0;7.0;6.5;Aprobado");
  });

  it("celdas vacías para instrumentos sin nota + estado incompleta", () => {
    const gb = consolidate([quiz, tarea], [student("e1", "Ana", { q1: 5.0 })]);
    const line = gradebookToCsv(gb, labels).trimEnd().split("\r\n")[1]!;
    expect(line).toBe("Ana;5126663-3;5.0;;5.0;Incompleta");
  });

  it("entrecomilla valores con separador o comillas", () => {
    const withSemicolon: GradebookInstrument = { id: "q1", kind: "quiz", title: 'Quiz "A"; parte 1', weight: 1 };
    const gb = consolidate([withSemicolon], [student("e1", "Pérez; Juan", { q1: 6 })]);
    const csv = gradebookToCsv(gb, labels);
    expect(csv).toContain('"Quiz ""A""; parte 1"');
    expect(csv).toContain('"Pérez; Juan"');
  });
});
