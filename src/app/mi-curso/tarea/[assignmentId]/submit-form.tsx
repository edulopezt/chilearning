"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldControl, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
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
    <Card className="p-4">
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="assignmentId" value={assignmentId} />
          <h3 className="font-semibold">{resubmit ? t.resubmit : t.submitTitle}</h3>
          <FieldRoot>
            <FieldLabel>{t.fileLabel}</FieldLabel>
            <FieldControl
              render={
                <input
                  name="file"
                  type="file"
                  required
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.txt,.zip"
                  className="rounded-md border p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-secondary-foreground"
                />
              }
            />
          </FieldRoot>
          <FieldRoot>
            <FieldLabel>{t.commentLabel}</FieldLabel>
            <FieldControl render={<Textarea name="comment" rows={2} />} />
          </FieldRoot>
          <div className="flex items-center gap-3">
            <Button type="submit" loading={pending}>
              {pending ? t.submitting : t.submit}
            </Button>
            {state.status === "ok" ? (
              <Alert variant="success" role="status" className="w-auto py-2">
                <AlertDescription>{t.submitted}</AlertDescription>
              </Alert>
            ) : null}
            {state.status === "error" ? (
              <Alert variant="destructive" role="alert" className="w-auto py-2">
                <AlertDescription>{ERROR_TEXT[state.error] ?? t.errorGeneric}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
