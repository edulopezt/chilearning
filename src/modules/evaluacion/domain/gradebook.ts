/**
 * Libro de notas por acción (task 2.3, HU-6.4 — D-022 §S10). Dominio puro:
 * consolida las notas PUBLICADAS de los instrumentos (quizzes + tareas) de un
 * curso, por inscripción, con PROMEDIO PONDERADO PARCIAL sobre lo ya calificado
 * y una marca "incompleta" mientras falte algún instrumento (decisión de Edu:
 * promedio parcial, NO castigar con 1.0 durante el curso). Sin IO.
 */

import { MAX_GRADE, MIN_GRADE, PASSING_GRADE } from "./scale";

export type InstrumentKind = "quiz" | "assignment";

export interface GradebookInstrument {
  readonly id: string;
  readonly kind: InstrumentKind;
  readonly title: string;
  /** Ponderación en el promedio del curso (>= 0). */
  readonly weight: number;
}

export interface GradebookStudent {
  readonly enrollmentId: string;
  readonly name: string;
  readonly run: string;
  /** instrumentId → nota publicada (1.0–7.0); ausente = aún sin nota. */
  readonly grades: ReadonlyMap<string, number>;
}

export interface GradebookCell {
  readonly instrumentId: string;
  readonly grade: number | null;
}

export interface GradebookRow {
  readonly enrollmentId: string;
  readonly name: string;
  readonly run: string;
  readonly cells: GradebookCell[];
  /** Promedio ponderado parcial sobre instrumentos CON nota; null si no hay ninguna. */
  readonly finalGrade: number | null;
  /** Falta al menos un instrumento por calificar. */
  readonly incomplete: boolean;
  /** Aprobación FINAL: solo definida cuando el libro está completo (si no, null). */
  readonly passed: boolean | null;
}

export interface Gradebook {
  readonly instruments: GradebookInstrument[];
  readonly rows: GradebookRow[];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Consolida el libro: por alumno, promedio ponderado de las notas presentes.
 * `minGrade` (S13, default 4.0) decide la aprobación cuando está completo.
 * El orden de las columnas y las filas se respeta tal como se entrega.
 */
export function consolidate(
  instruments: GradebookInstrument[],
  students: GradebookStudent[],
  minGrade: number = PASSING_GRADE,
): Gradebook {
  const rows: GradebookRow[] = students.map((s) => {
    const cells: GradebookCell[] = instruments.map((i) => ({
      instrumentId: i.id,
      grade: s.grades.has(i.id) ? clamp(s.grades.get(i.id)!) : null,
    }));

    let sumWeighted = 0;
    let sumWeight = 0;
    let gradedCount = 0;
    for (const i of instruments) {
      const g = s.grades.get(i.id);
      if (g === undefined) continue;
      gradedCount += 1;
      sumWeighted += clamp(g) * i.weight;
      sumWeight += i.weight;
    }

    const finalGrade = sumWeight > 0 ? round1(sumWeighted / sumWeight) : null;
    // "Incompleta" si hay instrumentos y falta calificar alguno.
    const incomplete = instruments.length > 0 && gradedCount < instruments.length;
    const passed =
      instruments.length === 0 || incomplete || finalGrade === null
        ? null
        : finalGrade >= minGrade;

    return { enrollmentId: s.enrollmentId, name: s.name, run: s.run, cells, finalGrade, incomplete, passed };
  });

  return { instruments, rows };
}

function clamp(g: number): number {
  if (!Number.isFinite(g)) return MIN_GRADE;
  return Math.min(Math.max(g, MIN_GRADE), MAX_GRADE);
}

export interface CsvLabels {
  readonly student: string;
  readonly run: string;
  readonly finalGrade: string;
  readonly status: string;
  readonly statusPassed: string;
  readonly statusFailed: string;
  readonly statusIncomplete: string;
  readonly statusNoGrades: string;
}

/** Estado de una fila (para CSV/UI): sin dato localizado en el dominio. */
export function rowStatus(row: GradebookRow): "passed" | "failed" | "incomplete" | "none" {
  const hasAny = row.cells.some((c) => c.grade !== null);
  if (!hasAny) return "none";
  if (row.incomplete) return "incomplete";
  // Completo pero sin promedio computable (p.ej. todos los pesos en 0): neutral,
  // NUNCA "reprobado" — no hay nota final que reprobar.
  if (row.passed === null || row.finalGrade === null) return "none";
  return row.passed ? "passed" : "failed";
}

function csvCell(value: string): string {
  // Neutraliza inyección de fórmulas (CWE-1236): si el valor empieza con
  // =,+,-,@,TAB o CR, antepone un apóstrofo para que la planilla lo trate como
  // texto (los nombres provienen del roster importado, de menor confianza).
  let v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  // Separador `;` para Excel es-CL; entrecomilla si trae `;`, comillas o saltos.
  if (/[";\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** CSV con BOM UTF-8 y separador `;` (abre directo en Excel es-CL). */
export function gradebookToCsv(gradebook: Gradebook, labels: CsvLabels): string {
  const statusLabel: Record<ReturnType<typeof rowStatus>, string> = {
    passed: labels.statusPassed,
    failed: labels.statusFailed,
    incomplete: labels.statusIncomplete,
    none: labels.statusNoGrades,
  };
  const header = [labels.student, labels.run, ...gradebook.instruments.map((i) => i.title), labels.finalGrade, labels.status];
  const lines = [header.map(csvCell).join(";")];
  for (const row of gradebook.rows) {
    const cells = [
      row.name,
      row.run,
      ...row.cells.map((c) => (c.grade === null ? "" : c.grade.toFixed(1))),
      row.finalGrade === null ? "" : row.finalGrade.toFixed(1),
      statusLabel[rowStatus(row)],
    ];
    lines.push(cells.map(csvCell).join(";"));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
