"use client";

import { useActionState, useTransition } from "react";

import { esCL } from "@/i18n/es-CL";
import type { PendingSubmission } from "@/modules/evaluacion/grading-service";
import {
  downloadSubmissionAction,
  publishGradeAction,
  saveDraftGradeAction,
  updateGradeAction,
  type GradeState,
} from "../actions";

const t = esCL.grading;

/**
 * Fila de corrección. El control depende del estado de la nota:
 *  - sin nota / borrador → guardar borrador (tutor o relator) + publicar (relator);
 *  - PUBLICADA → solo el relator la edita, y SIEMPRE con motivo (el gate del
 *    hito: `updateGradeAction`). El tutor ve la publicada bloqueada.
 */
export function GradeRow({
  submission,
  actionId,
  canPublish,
}: {
  submission: PendingSubmission;
  actionId: string;
  canPublish: boolean;
}) {
  const [draftState, draftAction, savingDraft] = useActionState<GradeState, FormData>(
    saveDraftGradeAction,
    { status: "idle" },
  );
  const [pubState, pubAction, publishing] = useActionState<GradeState, FormData>(
    publishGradeAction,
    { status: "idle" },
  );
  const [updState, updAction, updating] = useActionState<GradeState, FormData>(
    updateGradeAction,
    { status: "idle" },
  );
  const [downloading, startDownload] = useTransition();

  const isPublished = submission.gradeStatus === "published";
  const state =
    updState.status !== "idle"
      ? updState
      : pubState.status !== "idle"
        ? pubState
        : draftState;
  const validationMsg =
    state.status === "invalid" ? state.errors.map((e) => e.message).join(" · ") : null;

  return (
    <li className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">{submission.studentName}</span>
        <span className="text-muted-foreground text-sm">{submission.assignmentTitle}</span>
        <span className="text-muted-foreground text-xs">
          {t.colVersion} {submission.version}
        </span>
        {submission.late ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200">
            {t.lateBadge}
          </span>
        ) : null}
        {submission.gradeStatus ? (
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              isPublished
                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
          >
            {isPublished ? t.publishedBadge : t.draftBadge}
            {submission.currentGrade !== null ? ` · ${submission.currentGrade.toFixed(1)}` : ""}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">{t.noGrade}</span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          disabled={downloading}
          onClick={() =>
            startDownload(async () => {
              const url = await downloadSubmissionAction(submission.submissionId);
              if (url) window.open(url, "_blank", "noopener");
            })
          }
          className="text-sm underline disabled:opacity-60"
        >
          {t.downloadSubmission}
        </button>
      </div>

      {isPublished && !canPublish ? (
        // Tutor frente a una nota ya publicada: no la puede tocar.
        <p className="text-muted-foreground text-sm">{t.publishedLocked}</p>
      ) : isPublished && submission.gradeId ? (
        // Relator edita una publicada: SIEMPRE con motivo (gate del hito).
        <form className="flex flex-col gap-3">
          <input type="hidden" name="gradeId" value={submission.gradeId} />
          <input type="hidden" name="actionId" value={actionId} />
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <label className="flex flex-col gap-1 text-sm">
              {t.directGradeLabel}
              <input
                name="grade"
                type="number"
                min={1}
                max={7}
                step="0.1"
                defaultValue={submission.currentGrade ?? ""}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t.feedbackLabel}
              <textarea name="feedback" rows={2} className="input" />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            {t.motivoLabel}
            <textarea name="motivo" rows={2} required className="input" />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              formAction={updAction}
              disabled={updating}
              className="min-h-11 rounded-md bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
            >
              {t.updateGrade}
            </button>
            {updState.status === "published" ? (
              <span className="text-sm text-green-700 dark:text-green-400">{t.updated}</span>
            ) : null}
            {validationMsg ? (
              <span role="alert" className="text-sm text-red-600">
                {validationMsg}
              </span>
            ) : null}
            {state.status === "error" ? (
              <span role="alert" className="text-sm text-red-600">
                {t.genericError}
              </span>
            ) : null}
          </div>
        </form>
      ) : (
        // Sin nota o borrador: guardar borrador + (relator) publicar.
        <form className="flex flex-col gap-3">
          <input type="hidden" name="submissionId" value={submission.submissionId} />
          <input type="hidden" name="actionId" value={actionId} />
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <label className="flex flex-col gap-1 text-sm">
              {t.directGradeLabel}
              <input
                name="grade"
                type="number"
                min={1}
                max={7}
                step="0.1"
                defaultValue={submission.currentGrade ?? ""}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t.feedbackLabel}
              <textarea name="feedback" rows={2} className="input" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              formAction={draftAction}
              disabled={savingDraft || publishing}
              className="min-h-11 rounded-md border px-4 text-sm font-medium disabled:opacity-60"
            >
              {t.saveDraft}
            </button>
            {canPublish ? (
              <button
                type="submit"
                formAction={pubAction}
                disabled={savingDraft || publishing}
                className="min-h-11 rounded-md bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
              >
                {t.publishGrade}
              </button>
            ) : (
              <span className="text-muted-foreground text-xs">{t.onlyInstructorPublishes}</span>
            )}
            {draftState.status === "draft" ? (
              <span className="text-sm text-green-700 dark:text-green-400">{t.savedDraft}</span>
            ) : null}
            {pubState.status === "published" ? (
              <span className="text-sm text-green-700 dark:text-green-400">{t.published}</span>
            ) : null}
            {validationMsg ? (
              <span role="alert" className="text-sm text-red-600">
                {validationMsg}
              </span>
            ) : null}
            {state.status === "error" ? (
              <span role="alert" className="text-sm text-red-600">
                {t.genericError}
              </span>
            ) : null}
          </div>
        </form>
      )}
    </li>
  );
}
