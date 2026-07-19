"use client";

import Link from "next/link";
import { useState } from "react";
import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import type { SurveyQuestion } from "@/modules/evaluacion/domain/survey";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { submitSurveyAction, type StudentSurveyState } from "./actions";

const t = esCL.surveyStudent;

/** Formulario de respuesta del alumno (task 3.1). */
export function SurveyAnswerForm({
  surveyId,
  questions,
}: {
  surveyId: string;
  questions: readonly SurveyQuestion[];
}) {
  const [state, formAction, pending] = useActionState<StudentSurveyState, FormData>(submitSurveyAction, {
    status: "idle",
  });
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const set = (id: string, value: number | string): void => setAnswers((a) => ({ ...a, [id]: value }));

  if (state.status === "ok") {
    return (
      <Card className="items-center gap-4 p-6 text-center">
        <p className="text-lg font-medium text-success">{t.submitted}</p>
        <Link href="/mi-curso" className="text-sm underline underline-offset-4">
          {t.backToCourse}
        </Link>
      </Card>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="surveyId" value={surveyId} />
      <input type="hidden" name="answers" value={JSON.stringify(answers)} />

      {questions.map((q) => (
        <fieldset key={q.id} className="flex flex-col gap-2">
          <legend className="text-sm font-medium">
            {q.label} {q.required ? <span className="text-destructive">*</span> : null}
          </legend>
          {q.type === "scale" ? (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: q.scaleMax ?? 5 }, (_, i) => i + 1).map((n) => (
                <label
                  key={n}
                  className={cn(
                    "flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border px-3 transition-colors",
                    answers[q.id] === n && "border-primary bg-primary text-primary-foreground"
                  )}
                >
                  {/*
                    Input nativo con `name="radio-{q.id}"` preservado a propósito:
                    e2e/survey-submit.spec.ts lo selecciona directo por ese
                    selector (`input[name="radio-${questionId}"]`). Un
                    RadioGroup/Radio de Base UI (que no garantiza ese `name`
                    exacto) rompería el test — solo se retokenizó el color.
                  */}
                  <input
                    type="radio"
                    name={`radio-${q.id}`}
                    className="sr-only"
                    checked={answers[q.id] === n}
                    onChange={() => set(q.id, n)}
                  />
                  {n}
                </label>
              ))}
            </div>
          ) : q.type === "single" ? (
            <div className="flex flex-col gap-1">
              {(q.options ?? []).map((o) => (
                <label key={o.id} className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`radio-${q.id}`}
                    checked={answers[q.id] === o.id}
                    onChange={() => set(q.id, o.id)}
                    className="size-4 accent-primary"
                  />
                  {o.text}
                </label>
              ))}
            </div>
          ) : (
            <Textarea
              rows={3}
              value={typeof answers[q.id] === "string" ? (answers[q.id] as string) : ""}
              onChange={(e) => set(q.id, e.target.value)}
            />
          )}
        </fieldset>
      ))}

      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>
          {pending ? t.submitting : t.submit}
        </Button>
        {state.status === "invalid" ? (
          <Alert variant="destructive" role="alert" className="w-auto py-2">
            <AlertDescription>{t.errorRequired}</AlertDescription>
          </Alert>
        ) : null}
        {state.status === "notavailable" ? (
          <Alert variant="destructive" role="alert" className="w-auto py-2">
            <AlertDescription>{t.notAvailable}</AlertDescription>
          </Alert>
        ) : null}
        {state.status === "error" ? (
          <Alert variant="destructive" role="alert" className="w-auto py-2">
            <AlertDescription>{t.errorGeneric}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </form>
  );
}
