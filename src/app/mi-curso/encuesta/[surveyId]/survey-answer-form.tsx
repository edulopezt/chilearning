"use client";

import Link from "next/link";
import { useState } from "react";
import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import type { SurveyQuestion } from "@/modules/evaluacion/domain/survey";
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
      <div className="flex flex-col gap-4 rounded-lg border p-6 text-center">
        <p className="text-lg font-medium text-green-700 dark:text-green-400">{t.submitted}</p>
        <Link href="/mi-curso" className="text-sm underline">
          {t.backToCourse}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="surveyId" value={surveyId} />
      <input type="hidden" name="answers" value={JSON.stringify(answers)} />

      {questions.map((q) => (
        <fieldset key={q.id} className="flex flex-col gap-2">
          <legend className="text-sm font-medium">
            {q.label} {q.required ? <span className="text-red-600">*</span> : null}
          </legend>
          {q.type === "scale" ? (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: q.scaleMax ?? 5 }, (_, i) => i + 1).map((n) => (
                <label
                  key={n}
                  className={`flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border px-3 ${
                    answers[q.id] === n ? "border-blue-600 bg-blue-600 text-white" : ""
                  }`}
                >
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
                    className="size-4"
                  />
                  {o.text}
                </label>
              ))}
            </div>
          ) : (
            <textarea
              rows={3}
              value={typeof answers[q.id] === "string" ? (answers[q.id] as string) : ""}
              onChange={(e) => set(q.id, e.target.value)}
              className="input"
            />
          )}
        </fieldset>
      ))}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-md bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
        >
          {pending ? t.submitting : t.submit}
        </button>
        {state.status === "invalid" ? <span role="alert" className="text-sm text-red-600">{t.errorRequired}</span> : null}
        {state.status === "notavailable" ? <span role="alert" className="text-sm text-red-600">{t.notAvailable}</span> : null}
        {state.status === "error" ? <span role="alert" className="text-sm text-red-600">{t.errorGeneric}</span> : null}
      </div>
    </form>
  );
}
