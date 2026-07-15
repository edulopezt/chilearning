"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import { submitAssignmentAction, type SubmitState } from "./actions";

const t = esCL.assignmentStudent;

const ERROR_TEXT: Record<string, string> = {
  file_rejected: t.errorFile,
  late_rejected: t.errorLate,
  not_published: t.errorNotPublished,
  not_enrolled: t.errorNotPublished,
};

/** Formulario de entrega (archivo + comentario). */
export function SubmitForm({ assignmentId, resubmit }: { assignmentId: string; resubmit: boolean }) {
  const [state, formAction, pending] = useActionState<SubmitState, FormData>(submitAssignmentAction, {
    status: "idle",
  });
  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-md border p-4">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <h3 className="font-semibold">{resubmit ? t.resubmit : t.submitTitle}</h3>
      <label className="flex flex-col gap-1 text-sm">
        {t.fileLabel}
        <input
          name="file"
          type="file"
          required
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.txt,.zip"
          className="rounded-md border p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-neutral-200 file:px-3 file:py-2 dark:file:bg-neutral-700"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t.commentLabel}
        <textarea name="comment" rows={2} className="input" />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-md bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
        >
          {pending ? t.submitting : t.submit}
        </button>
        {state.status === "ok" ? <span className="text-sm text-green-700 dark:text-green-400">{t.submitted}</span> : null}
        {state.status === "error" ? (
          <span role="alert" className="text-sm text-red-600">
            {ERROR_TEXT[state.error] ?? t.errorGeneric}
          </span>
        ) : null}
      </div>
    </form>
  );
}
