"use client";

import { useActionState, useTransition } from "react";

import { esCL } from "@/i18n/es-CL";
import type { PendingSubmission } from "@/modules/evaluacion/grading-service";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldControl, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
    <li>
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">{submission.studentName}</span>
          <span className="text-sm text-muted-foreground">{submission.assignmentTitle}</span>
          <span className="text-xs text-muted-foreground">
            {t.colVersion} {submission.version}
          </span>
          {submission.late ? <Badge variant="warning">{t.lateBadge}</Badge> : null}
          {submission.gradeStatus ? (
            <Badge variant={isPublished ? "success" : "secondary"}>
              {isPublished ? t.publishedBadge : t.draftBadge}
              {submission.currentGrade !== null ? ` · ${submission.currentGrade.toFixed(1)}` : ""}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">{t.noGrade}</span>
          )}
          <span className="flex-1" />
          <Button
            type="button"
            variant="link"
            loading={downloading}
            onClick={() =>
              startDownload(async () => {
                const url = await downloadSubmissionAction(submission.submissionId);
                if (url) window.open(url, "_blank", "noopener");
              })
            }
          >
            {t.downloadSubmission}
          </Button>
        </div>

        {isPublished && !canPublish ? (
          // Tutor frente a una nota ya publicada: no la puede tocar.
          <p className="text-sm text-muted-foreground">{t.publishedLocked}</p>
        ) : isPublished && submission.gradeId ? (
          // Relator edita una publicada: SIEMPRE con motivo (gate del hito).
          <form className="flex flex-col gap-3">
            <input type="hidden" name="gradeId" value={submission.gradeId} />
            <input type="hidden" name="actionId" value={actionId} />
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <FieldRoot>
                <FieldLabel>{t.directGradeLabel}</FieldLabel>
                <FieldControl
                  render={
                    <Input name="grade" type="number" min={1} max={7} step="0.1" defaultValue={submission.currentGrade ?? ""} />
                  }
                />
              </FieldRoot>
              <FieldRoot>
                <FieldLabel>{t.feedbackLabel}</FieldLabel>
                <FieldControl render={<Textarea name="feedback" rows={2} />} />
              </FieldRoot>
            </div>
            <FieldRoot>
              <FieldLabel>{t.motivoLabel}</FieldLabel>
              <FieldControl render={<Textarea name="motivo" rows={2} required />} />
            </FieldRoot>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" formAction={updAction} loading={updating}>
                {t.updateGrade}
              </Button>
              {updState.status === "published" ? (
                <Alert variant="success" role="status" className="w-auto py-2">
                  <AlertDescription>{t.updated}</AlertDescription>
                </Alert>
              ) : null}
              {validationMsg ? (
                <Alert variant="destructive" role="alert" className="w-auto py-2">
                  <AlertDescription>{validationMsg}</AlertDescription>
                </Alert>
              ) : null}
              {state.status === "error" ? (
                <Alert variant="destructive" role="alert" className="w-auto py-2">
                  <AlertDescription>{t.genericError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </form>
        ) : (
          // Sin nota o borrador: guardar borrador + (relator) publicar.
          <form className="flex flex-col gap-3">
            <input type="hidden" name="submissionId" value={submission.submissionId} />
            <input type="hidden" name="actionId" value={actionId} />
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <FieldRoot>
                <FieldLabel>{t.directGradeLabel}</FieldLabel>
                <FieldControl
                  render={
                    <Input name="grade" type="number" min={1} max={7} step="0.1" defaultValue={submission.currentGrade ?? ""} />
                  }
                />
              </FieldRoot>
              <FieldRoot>
                <FieldLabel>{t.feedbackLabel}</FieldLabel>
                <FieldControl render={<Textarea name="feedback" rows={2} />} />
              </FieldRoot>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="outline" formAction={draftAction} loading={savingDraft} disabled={publishing}>
                {t.saveDraft}
              </Button>
              {canPublish ? (
                <Button type="submit" formAction={pubAction} loading={publishing} disabled={savingDraft}>
                  {t.publishGrade}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">{t.onlyInstructorPublishes}</span>
              )}
              {draftState.status === "draft" ? (
                <Alert variant="success" role="status" className="w-auto py-2">
                  <AlertDescription>{t.savedDraft}</AlertDescription>
                </Alert>
              ) : null}
              {pubState.status === "published" ? (
                <Alert variant="success" role="status" className="w-auto py-2">
                  <AlertDescription>{t.published}</AlertDescription>
                </Alert>
              ) : null}
              {validationMsg ? (
                <Alert variant="destructive" role="alert" className="w-auto py-2">
                  <AlertDescription>{validationMsg}</AlertDescription>
                </Alert>
              ) : null}
              {state.status === "error" ? (
                <Alert variant="destructive" role="alert" className="w-auto py-2">
                  <AlertDescription>{t.genericError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </form>
        )}
      </Card>
    </li>
  );
}
