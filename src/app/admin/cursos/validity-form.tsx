"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import type { MutationResult } from "@/modules/academico/course-service";
import { updateCourseValidityAction } from "./actions";

const t = esCL.courses;

function validityError(state: MutationResult | null): string | null {
  if (state && !state.ok && "validation" in state) return state.validation[0]?.message ?? null;
  return null;
}

/**
 * Edición inline de la vigencia del certificado por curso (task 5.12, HU-7.3,
 * 4-ojos MED). Vacío = no vence. Manda SOLO `validityMonths`: la Server Action
 * hace un patch de esa única columna (no reescribe el resto del curso).
 */
export function ValidityForm({
  courseId,
  validityMonths,
}: {
  courseId: string;
  validityMonths: number | null;
}) {
  const [state, formAction, pending] = useActionState<MutationResult | null, FormData>(
    updateCourseValidityAction,
    null,
  );
  const error = validityError(state);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input type="hidden" name="courseId" value={courseId} />
        <input
          name="validityMonths"
          type="number"
          min={1}
          max={120}
          defaultValue={validityMonths ?? ""}
          placeholder="—"
          aria-label={esCL.certExpiry.validityLabel}
          className="min-h-11 w-20 rounded-md border px-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-md border px-3 text-xs font-medium disabled:opacity-60"
        >
          {t.validitySave}
        </button>
      </div>
      {state?.ok ? (
        <span role="status" className="text-xs text-green-700 dark:text-green-400">
          {t.validitySaved}
        </span>
      ) : null}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </form>
  );
}
