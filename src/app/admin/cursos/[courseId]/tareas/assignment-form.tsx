"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import { createAssignmentAction, type AssignmentActionState } from "./actions";

const t = esCL.assignments;

/** Form de creación de tarea (nota directa; rúbrica = follow-up de UI). */
export function AssignmentForm({ courseId }: { courseId: string }) {
  const [state, formAction, pending] = useActionState<AssignmentActionState, FormData>(
    createAssignmentAction,
    { status: "idle" },
  );
  const err = (field: string): string | undefined =>
    state.status === "invalid" ? state.errors.find((e) => e.field === field)?.message : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="courseId" value={courseId} />
      <label className="flex flex-col gap-1 text-sm">
        {t.titleLabel}
        <input name="title" required className="input" />
        {err("title") ? <span className="text-xs text-red-600">{err("title")}</span> : null}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t.instructionsLabel}
        <textarea name="instructions" rows={3} className="input" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          {t.dueLabel}
          <input name="dueAt" type="datetime-local" className="input" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.graceLabel}
          <input name="graceHours" type="number" min={0} max={720} defaultValue={0} className="input" />
          {err("graceHours") ? <span className="text-xs text-red-600">{err("graceHours")}</span> : null}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.passingLabel}
          <input name="passingPct" type="number" min={1} max={99} defaultValue={60} className="input" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.weightLabel}
          <input name="weight" type="number" min={0} step="0.5" defaultValue={1} className="input" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="min-h-11 rounded-md bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900">
          {t.save}
        </button>
        {state.status === "ok" ? <span className="text-sm text-green-700 dark:text-green-400">{t.saved}</span> : null}
        {state.status === "error" ? <span role="alert" className="text-sm text-red-600">{t.genericError}</span> : null}
      </div>
    </form>
  );
}
