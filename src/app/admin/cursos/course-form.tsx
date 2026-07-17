"use client";

import { useActionState, useState } from "react";

import { esCL } from "@/i18n/es-CL";
import type { MutationResult } from "@/modules/academico/course-service";
import { createCourseAction } from "./actions";

const t = esCL.courses;
const tExpiry = esCL.certExpiry;

function fieldErrors(state: MutationResult | null): Record<string, string> {
  if (state && !state.ok && "validation" in state) {
    return Object.fromEntries(state.validation.map((e) => [e.field, e.message]));
  }
  return {};
}

export function CourseForm() {
  const [state, formAction, pending] = useActionState<MutationResult | null, FormData>(
    createCourseAction,
    null,
  );
  const [sence, setSence] = useState(false);
  const errors = fieldErrors(state);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1 text-sm">
        {t.nameLabel}
        <input name="name" required className="min-h-11 rounded-md border px-3 text-base" />
        {errors.name ? <span className="text-xs text-red-600">{errors.name}</span> : null}
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          {t.modalityLabel}
          <select name="modality" defaultValue="elearning" className="min-h-11 rounded-md border px-3 text-base">
            <option value="elearning">{t.modElearning}</option>
            <option value="blended">{t.modBlended}</option>
            <option value="presential">{t.modPresential}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.hoursLabel}
          <input name="hours" type="number" min={0} defaultValue={0} className="min-h-11 rounded-md border px-3 text-base" />
          {errors.hours ? <span className="text-xs text-red-600">{errors.hours}</span> : null}
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input name="sence" type="checkbox" value="true" checked={sence} onChange={(e) => setSence(e.target.checked)} className="size-4" />
        {t.senceLabel}
      </label>

      {sence ? (
        <label className="flex flex-col gap-1 text-sm">
          {t.codSenceLabel}
          <input name="codSence" inputMode="numeric" maxLength={10} className="min-h-11 rounded-md border px-3 font-mono text-base" />
          <span className="text-muted-foreground text-xs">{t.codSenceHint}</span>
          {errors.codSence ? <span className="text-xs text-red-600">{errors.codSence}</span> : null}
        </label>
      ) : null}

      <fieldset className="flex flex-col gap-3 rounded-md border p-4">
        <legend className="px-1 text-sm font-medium">{t.rulesTitle}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input name="requireAllLessons" type="checkbox" value="true" defaultChecked className="size-4" />
          {t.requireAllLessons}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input name="requireSurvey" type="checkbox" value="true" className="size-4" />
          {t.requireSurvey}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.minAttendance}
          <input name="minAttendancePct" type="number" min={0} max={100} defaultValue={0} className="min-h-11 w-32 rounded-md border px-3 text-base" />
        </label>
      </fieldset>

      {/* Vigencia del certificado (task 5.12, HU-7.3): vacío = no vence. */}
      <label className="flex flex-col gap-1 text-sm">
        {tExpiry.validityLabel}
        <input
          name="validityMonths"
          type="number"
          min={1}
          max={120}
          placeholder="—"
          className="min-h-11 w-32 rounded-md border px-3 text-base"
        />
        <span className="text-muted-foreground text-xs">{tExpiry.validityHint}</span>
        {errors.validityMonths ? <span className="text-xs text-red-600">{errors.validityMonths}</span> : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t.statusLabel}
        <select name="status" defaultValue="draft" className="min-h-11 w-full max-w-xs rounded-md border px-3 text-base">
          <option value="draft">{t.statusDraft}</option>
          <option value="published">{t.statusPublished}</option>
        </select>
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
