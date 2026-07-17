"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import { WIZARD_TEMPLATES } from "@/modules/academico/domain/course-wizard";
import { createDraftDescriptorAction, createDraftScratchAction, type CreateDraftState } from "./actions";

const t = esCL.wizard;
const btn =
  "min-h-11 rounded-md bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900";

/** Las DOS entradas del asistente (HU-4.5): desde cero (con plantilla) o desde un descriptor SENCE. */
export function NewDraftForms() {
  const [scratchState, scratchAction, scratchPending] = useActionState<CreateDraftState, FormData>(
    createDraftScratchAction,
    { status: "idle" },
  );
  const [descriptorState, descriptorAction, descriptorPending] = useActionState<CreateDraftState, FormData>(
    createDraftDescriptorAction,
    { status: "idle" },
  );

  return (
    <section className="grid gap-6 border-t pt-6 sm:grid-cols-2">
      <form action={scratchAction} className="flex flex-col gap-3 rounded-md border p-4">
        <h2 className="text-base font-semibold">{t.fromScratch}</h2>
        <label className="flex flex-col gap-1 text-sm">
          {t.templateLabel}
          <select name="templateId" defaultValue="" className="min-h-11 rounded-md border px-3 text-base">
            <option value="">{t.templateNone}</option>
            {Object.values(WIZARD_TEMPLATES).map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={scratchPending} className={btn}>
          {t.startFromScratch}
        </button>
        {scratchState.status === "error" ? (
          <p role="alert" className="text-sm text-red-600">
            {t.genericError}
          </p>
        ) : null}
      </form>

      <form action={descriptorAction} className="flex flex-col gap-3 rounded-md border p-4">
        <h2 className="text-base font-semibold">{t.fromDescriptor}</h2>
        <label className="flex flex-col gap-1 text-sm">
          {t.descriptorFileLabel}
          <input
            name="file"
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            required
            className="text-sm"
          />
          <span className="text-muted-foreground text-xs">{t.descriptorFileHint}</span>
        </label>
        <button type="submit" disabled={descriptorPending} className={btn}>
          {t.startFromDescriptor}
        </button>
        {descriptorState.status === "file" ? (
          <p role="alert" className="text-sm text-red-600">
            {t.descriptorFileError}
          </p>
        ) : null}
        {descriptorState.status === "error" ? (
          <p role="alert" className="text-sm text-red-600">
            {t.genericError}
          </p>
        ) : null}
      </form>
    </section>
  );
}
