/**
 * Reglas puras de las tareas con entrega (task 2.2, HU-6.2 — D-022 §S8/S9).
 * Parse del instrumento y de la rúbrica, tolerancia de fechas y puntaje de
 * rúbrica. Sin IO. Los tipos de FieldError vienen del dominio de quizzes.
 */

import { chileanGrade, MAX_GRADE, MIN_GRADE } from "./scale";
import type { FieldError, ParseResult } from "./quiz";

// ---------- rúbrica ----------

export interface RubricLevel {
  readonly id: string;
  readonly label: string;
  readonly points: number;
}
export interface RubricCriterion {
  readonly id: string;
  readonly title: string;
  readonly levels: readonly RubricLevel[];
}
export interface Rubric {
  readonly criteria: readonly RubricCriterion[];
}

export function parseRubric(raw: unknown): ParseResult<Rubric | null> {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const criteriaRaw = Array.isArray(obj.criteria) ? obj.criteria : [];
  const errors: FieldError[] = [];

  const criteria: RubricCriterion[] = [];
  criteriaRaw.forEach((c, ci) => {
    const cObj = (typeof c === "object" && c !== null ? c : {}) as Record<string, unknown>;
    const title = String(cObj.title ?? "").trim();
    const levelsRaw = Array.isArray(cObj.levels) ? cObj.levels : [];
    if (title === "") errors.push({ field: `criteria.${ci}.title`, message: "Criterio sin título." });
    const levels: RubricLevel[] = levelsRaw
      .map((l, li) => {
        const lObj = (typeof l === "object" && l !== null ? l : {}) as Record<string, unknown>;
        return {
          id: String(lObj.id ?? `l${li + 1}`),
          label: String(lObj.label ?? "").trim(),
          points: Number(lObj.points ?? 0),
        };
      })
      .filter((l) => l.label !== "" && Number.isFinite(l.points) && l.points >= 0);
    if (levels.length < 2) {
      errors.push({ field: `criteria.${ci}.levels`, message: "Cada criterio necesita ≥2 niveles." });
    }
    criteria.push({ id: String(cObj.id ?? `c${ci + 1}`), title, levels });
  });

  if (criteria.length === 0) {
    errors.push({ field: "criteria", message: "La rúbrica necesita al menos un criterio." });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { criteria } };
}

/** Máximo puntaje de una rúbrica (mejor nivel de cada criterio). */
export function rubricMaxPoints(rubric: Rubric): number {
  return rubric.criteria.reduce(
    (acc, c) => acc + Math.max(0, ...c.levels.map((l) => l.points)),
    0,
  );
}

export interface RubricScoreResult {
  readonly points: number;
  readonly maxPoints: number;
  readonly grade: number;
}

/**
 * Puntaje de rúbrica → nota chilena (S8/S1). `selection` = {criterionId: levelId}.
 * Nivel no elegido o inexistente = 0 puntos en ese criterio.
 */
export function rubricScore(
  rubric: Rubric,
  selection: Record<string, string>,
  passingPct: number,
): RubricScoreResult {
  let points = 0;
  for (const c of rubric.criteria) {
    const chosen = c.levels.find((l) => l.id === selection[c.id]);
    points += chosen?.points ?? 0;
  }
  const maxPoints = rubricMaxPoints(rubric);
  return { points, maxPoints, grade: chileanGrade(points, maxPoints, passingPct) };
}

// ---------- instrumento ----------

export interface AssignmentInput {
  readonly title: string;
  readonly instructions: string;
  readonly dueAt: string | null;
  readonly graceHours: number;
  readonly rubric: Rubric | null;
  readonly passingPct: number;
  readonly weight: number;
}

export function parseAssignmentInput(
  raw: Record<string, unknown>,
): ParseResult<AssignmentInput> {
  const errors: FieldError[] = [];
  const title = String(raw.title ?? "").trim();
  if (title.length < 1 || title.length > 200) {
    errors.push({ field: "title", message: "El título es obligatorio (máx. 200)." });
  }

  const graceHours = Number(raw.graceHours ?? 0);
  if (!Number.isInteger(graceHours) || graceHours < 0 || graceHours > 720) {
    errors.push({ field: "graceHours", message: "La tolerancia debe ser 0–720 horas." });
  }
  const passingPct = Number(raw.passingPct ?? 60);
  if (!Number.isInteger(passingPct) || passingPct < 1 || passingPct > 99) {
    errors.push({ field: "passingPct", message: "La exigencia debe ser un entero 1–99." });
  }
  const weight = Number(raw.weight ?? 1);
  if (!Number.isFinite(weight) || weight < 0 || weight > 1000) {
    errors.push({ field: "weight", message: "La ponderación debe ser un número ≥ 0." });
  }

  const rubricParsed = parseRubric(raw.rubric);
  if (!rubricParsed.ok) return { ok: false, errors: [...errors, ...rubricParsed.errors] };

  const dueRaw = String(raw.dueAt ?? "").trim();
  const dueAt = dueRaw === "" ? null : dueRaw;
  if (dueAt !== null && Number.isNaN(Date.parse(dueAt))) {
    errors.push({ field: "dueAt", message: "La fecha límite no es válida." });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      instructions: String(raw.instructions ?? "").trim(),
      dueAt,
      graceHours,
      rubric: rubricParsed.value,
      passingPct,
      weight,
    },
  };
}

// ---------- tolerancia de fechas (S9) ----------

export type Lateness = "on_time" | "late" | "rejected";

/** ¿A tiempo, tardía (dentro de la gracia) o rechazada? */
export function lateness(
  dueAt: string | null,
  graceHours: number,
  submittedAtMs: number,
): Lateness {
  if (!dueAt) return "on_time"; // sin plazo, siempre a tiempo
  const dueMs = Date.parse(dueAt);
  if (Number.isNaN(dueMs)) return "on_time";
  if (submittedAtMs <= dueMs) return "on_time";
  const graceMs = dueMs + graceHours * 3_600_000;
  return submittedAtMs <= graceMs ? "late" : "rejected";
}

// ---------- validación de archivo (espejo del bucket) ----------

export const MAX_SUBMISSION_BYTES = 20 * 1024 * 1024;
export const ALLOWED_SUBMISSION_MIME: readonly string[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

export function validateSubmissionFile(file: {
  name: string;
  size: number;
  type: string;
}): { ok: true } | { ok: false; message: string } {
  if (file.size <= 0) return { ok: false, message: "El archivo está vacío." };
  if (file.size > MAX_SUBMISSION_BYTES) {
    return { ok: false, message: "El archivo supera los 20 MB." };
  }
  if (!ALLOWED_SUBMISSION_MIME.includes(file.type)) {
    return { ok: false, message: "Tipo de archivo no permitido (usa PDF, Office, imagen, texto o ZIP)." };
  }
  return { ok: true };
}

/** Slug seguro para el nombre de archivo en la ruta del bucket. */
export function safeFileSlug(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "archivo"
  );
}

// ---------- nota directa ----------

export function validateDirectGrade(grade: number): { ok: true } | { ok: false; message: string } {
  if (!Number.isFinite(grade) || grade < MIN_GRADE || grade > MAX_GRADE) {
    return { ok: false, message: "La nota debe estar entre 1.0 y 7.0." };
  }
  if (Math.round(grade * 10) !== grade * 10) {
    return { ok: false, message: "La nota usa un decimal (p.ej. 5.5)." };
  }
  return { ok: true };
}
