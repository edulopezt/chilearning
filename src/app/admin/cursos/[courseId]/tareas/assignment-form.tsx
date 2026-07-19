"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldControl, FieldError, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
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
      <FieldRoot invalid={!!err("title")}>
        <FieldLabel>{t.titleLabel}</FieldLabel>
        <FieldControl name="title" required />
        {err("title") ? <FieldError>{err("title")}</FieldError> : null}
      </FieldRoot>
      <FieldRoot>
        <FieldLabel>{t.instructionsLabel}</FieldLabel>
        <FieldControl name="instructions" render={<Textarea rows={3} />} />
      </FieldRoot>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRoot>
          <FieldLabel>{t.dueLabel}</FieldLabel>
          <FieldControl name="dueAt" type="datetime-local" />
        </FieldRoot>
        <FieldRoot invalid={!!err("graceHours")}>
          <FieldLabel>{t.graceLabel}</FieldLabel>
          <FieldControl name="graceHours" type="number" min={0} max={720} defaultValue={0} />
          {err("graceHours") ? <FieldError>{err("graceHours")}</FieldError> : null}
        </FieldRoot>
        <FieldRoot>
          <FieldLabel>{t.passingLabel}</FieldLabel>
          <FieldControl name="passingPct" type="number" min={1} max={99} defaultValue={60} />
        </FieldRoot>
        <FieldRoot>
          <FieldLabel>{t.weightLabel}</FieldLabel>
          <FieldControl name="weight" type="number" min={0} step="0.5" defaultValue={1} />
        </FieldRoot>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>
          {t.save}
        </Button>
        {state.status === "ok" ? (
          <Alert variant="success" role="status" className="w-auto py-2">
            <AlertDescription>{t.saved}</AlertDescription>
          </Alert>
        ) : null}
        {state.status === "error" ? (
          <Alert variant="destructive" role="alert" className="w-auto py-2">
            <AlertDescription>{t.genericError}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </form>
  );
}
