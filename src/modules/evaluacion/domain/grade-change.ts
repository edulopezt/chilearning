/**
 * Reglas del cambio de nota (task 2.3 se apoya aquí; HU-6.4 CA — D-022 §S11):
 * editar una nota PUBLICADA exige MOTIVO y deja rastro en audit_log; el draft
 * se edita libre. Dominio puro.
 */

import { MAX_GRADE, MIN_GRADE } from "./scale";
import type { FieldError } from "./quiz";

export interface GradeChangeInput {
  readonly currentStatus: "draft" | "published";
  readonly nextGrade: number;
  readonly nextFeedback: string;
  /** Obligatorio si la nota está publicada (S11). */
  readonly motivo: string | null;
}

export type GradeChangeResult =
  | { readonly ok: true; readonly requiresAudit: boolean }
  | { readonly ok: false; readonly errors: FieldError[] };

export function validateGradeChange(input: GradeChangeInput): GradeChangeResult {
  const errors: FieldError[] = [];

  if (
    !Number.isFinite(input.nextGrade) ||
    input.nextGrade < MIN_GRADE ||
    input.nextGrade > MAX_GRADE
  ) {
    errors.push({ field: "grade", message: "La nota debe estar entre 1.0 y 7.0." });
  }
  if (Math.round(input.nextGrade * 10) !== input.nextGrade * 10) {
    errors.push({ field: "grade", message: "La nota usa un decimal (p.ej. 5.5)." });
  }
  if (input.nextFeedback.length > 4000) {
    errors.push({ field: "feedback", message: "La retroalimentación supera los 4000 caracteres." });
  }

  const requiresAudit = input.currentStatus === "published";
  if (requiresAudit && (!input.motivo || input.motivo.trim().length < 5)) {
    errors.push({
      field: "motivo",
      message: "Cambiar una nota publicada exige un motivo (mínimo 5 caracteres).",
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, requiresAudit };
}
