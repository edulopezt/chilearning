"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import { DOC_TYPE_LABEL, DOC_TYPES } from "@/modules/reportes/domain/expediente";
import { uploadDocumentAction, type ExpedienteState } from "./actions";

const t = esCL.expediente;

/** Subida de un documento al expediente (task 3.12). */
export function UploadForm({ actionId }: { actionId: string }) {
  const [state, formAction, pending] = useActionState<ExpedienteState, FormData>(uploadDocumentAction, { status: "idle" });
  return (
    <form action={formAction} className="flex flex-col gap-2 border-t pt-4">
      <input type="hidden" name="actionId" value={actionId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          {t.typeLabel}
          <select name="docType" className="input">
            {DOC_TYPES.map((d) => (
              <option key={d} value={d}>{DOC_TYPE_LABEL[d]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.dateLabel}
          <input name="documentDate" type="date" className="input" />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        {t.titleLabel}
        <input name="title" required className="input" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t.fileLabel}
        <input name="file" type="file" required className="text-sm" />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="min-h-11 rounded-md bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900">
          {t.save}
        </button>
        {state.status === "ok" ? <span className="text-sm text-green-700 dark:text-green-400">{t.saved}</span> : null}
        {state.status === "file" ? <span role="alert" className="text-sm text-red-600">{t.fileError}</span> : null}
        {state.status === "error" ? <span role="alert" className="text-sm text-red-600">{t.genericError}</span> : null}
      </div>
    </form>
  );
}
