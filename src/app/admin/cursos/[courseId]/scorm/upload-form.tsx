"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import { uploadScormAction, type ScormUploadState } from "./actions";

const t = esCL.scorm;

/** Form de subida de un paquete SCORM (task 5.1a). La validación real corre en el worker. */
export function UploadForm({ courseId }: { courseId: string }) {
  const action = uploadScormAction.bind(null, courseId);
  const [state, formAction, pending] = useActionState<ScormUploadState, FormData>(action, { status: "idle" });

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {t.titleLabel}
        <input name="title" required maxLength={200} className="min-h-11 rounded-md border px-3 text-base" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t.fileLabel}
        <input name="file" type="file" accept=".zip,application/zip,application/x-zip-compressed" required className="text-sm" />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-md bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
        >
          {t.upload}
        </button>
        {state.status === "ok" ? <span className="text-sm text-green-700 dark:text-green-400">{t.uploaded}</span> : null}
        {state.status === "file" ? <span role="alert" className="text-sm text-red-600">{t.fileError}</span> : null}
        {state.status === "error" ? <span role="alert" className="text-sm text-red-600">{t.genericError}</span> : null}
      </div>
    </form>
  );
}
