"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import type { ActionMutationResult } from "@/modules/academico/action-service";
import { createActionAction } from "./actions";

const t = esCL.actions;

function fieldErrors(state: ActionMutationResult | null): Record<string, string> {
  if (state && !state.ok && "validation" in state) {
    return Object.fromEntries(state.validation.map((e) => [e.field, e.message]));
  }
  return {};
}

export function ActionForm({
  courses,
  initialCourseId,
}: {
  courses: { id: string; name: string }[];
  /** Curso preseleccionado (task 5.12: enlace "crear acción" de vencimientos).
   *  Un id que no sea del tenant se ignora: no se confía en el searchParam. */
  initialCourseId?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionMutationResult | null, FormData>(
    createActionAction,
    null,
  );
  const errors = fieldErrors(state);
  const defaultCourseId =
    initialCourseId && courses.some((c) => c.id === initialCourseId) ? initialCourseId : courses[0]?.id;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1 text-sm">
        {t.courseLabel}
        <select name="courseId" required defaultValue={defaultCourseId} className="min-h-11 rounded-md border px-3 text-base">
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {errors.courseId ? <span className="text-xs text-red-600">{errors.courseId}</span> : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t.codeLabel}
        <input name="codigoAccion" required maxLength={50} className="min-h-11 rounded-md border px-3 font-mono text-base" />
        <span className="text-muted-foreground text-xs">{t.codeHint}</span>
        {errors.codigoAccion ? <span className="text-xs text-red-600">{errors.codigoAccion}</span> : null}
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          {t.lineLabel}
          <select name="trainingLine" defaultValue="3" className="min-h-11 rounded-md border px-3 text-base">
            <option value="1">{t.line1}</option>
            <option value="3">{t.line3}</option>
            <option value="6">{t.line6}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.envLabel}
          <select name="environment" defaultValue="rcetest" className="min-h-11 rounded-md border px-3 text-base">
            <option value="rcetest">{t.envTest}</option>
            <option value="rce">{t.envProd}</option>
          </select>
          {errors.environment ? <span className="text-xs text-red-600">{errors.environment}</span> : null}
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          {t.startsLabel}
          <input name="startsOn" type="date" className="min-h-11 rounded-md border px-3 text-base" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.endsLabel}
          <input name="endsOn" type="date" className="min-h-11 rounded-md border px-3 text-base" />
        </label>
      </div>
      {errors.dates ? <span className="text-xs text-red-600">{errors.dates}</span> : null}

      <label className="flex items-center gap-2 text-sm">
        <input name="attendanceLock" type="checkbox" value="true" defaultChecked className="size-4" />
        {t.lockLabel}
      </label>

      {state?.ok ? (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">{t.saved}</p>
      ) : null}
      {state && !state.ok && "error" in state ? (
        <p role="alert" className="text-sm text-red-600">{t.genericError}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-md bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 sm:w-auto dark:bg-white dark:text-neutral-900"
      >
        {t.save}
      </button>
    </form>
  );
}
