"use client";

import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldControl, FieldDescription, FieldError, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
      <FieldRoot invalid={!!errors.courseId}>
        <FieldLabel>{t.courseLabel}</FieldLabel>
        <Select name="courseId" required defaultValue={defaultCourseId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {courses.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.courseId ? <FieldError>{errors.courseId}</FieldError> : null}
      </FieldRoot>

      <FieldRoot invalid={!!errors.codigoAccion}>
        <FieldLabel>{t.codeLabel}</FieldLabel>
        <FieldControl name="codigoAccion" required maxLength={50} className="font-mono" />
        <FieldDescription>{t.codeHint}</FieldDescription>
        {errors.codigoAccion ? <FieldError>{errors.codigoAccion}</FieldError> : null}
      </FieldRoot>

      <div className="grid gap-5 sm:grid-cols-2">
        <FieldRoot>
          <FieldLabel>{t.lineLabel}</FieldLabel>
          <Select name="trainingLine" defaultValue="3">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">{t.line1}</SelectItem>
              <SelectItem value="3">{t.line3}</SelectItem>
              <SelectItem value="6">{t.line6}</SelectItem>
            </SelectContent>
          </Select>
        </FieldRoot>
        <FieldRoot invalid={!!errors.environment}>
          <FieldLabel>{t.envLabel}</FieldLabel>
          <Select name="environment" defaultValue="rcetest">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rcetest">{t.envTest}</SelectItem>
              <SelectItem value="rce">{t.envProd}</SelectItem>
            </SelectContent>
          </Select>
          {errors.environment ? <FieldError>{errors.environment}</FieldError> : null}
        </FieldRoot>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FieldRoot>
          <FieldLabel>{t.startsLabel}</FieldLabel>
          <FieldControl type="date" name="startsOn" />
        </FieldRoot>
        <FieldRoot>
          <FieldLabel>{t.endsLabel}</FieldLabel>
          <FieldControl type="date" name="endsOn" />
        </FieldRoot>
      </div>
      {errors.dates ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{errors.dates}</AlertDescription>
        </Alert>
      ) : null}

      <Label>
        <Checkbox name="attendanceLock" value="true" defaultChecked />
        {t.lockLabel}
      </Label>

      {state?.ok ? (
        <Alert variant="success" role="status">
          <AlertDescription>{t.saved}</AlertDescription>
        </Alert>
      ) : null}
      {state && !state.ok && "error" in state ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t.genericError}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" loading={pending} className="w-full sm:w-auto">
        {t.save}
      </Button>
    </form>
  );
}
