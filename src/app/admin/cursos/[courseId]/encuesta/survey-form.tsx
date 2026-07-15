"use client";

import { useRef, useState } from "react";
import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import { createSurveyAction, type SurveyActionState } from "./actions";

const t = esCL.surveys;

type EditorType = "scale" | "single" | "text";

interface EditorQuestion {
  readonly key: number;
  type: EditorType;
  label: string;
  required: boolean;
  scaleMax: number;
  optionsText: string;
}

/** Serializa el editor al formato de dominio (options desde líneas de texto). */
function buildQuestions(questions: readonly EditorQuestion[]): unknown[] {
  return questions.map((q, i) => {
    const id = `q${i + 1}`;
    if (q.type === "scale") return { id, type: "scale", label: q.label, required: q.required, scaleMax: q.scaleMax };
    if (q.type === "single") {
      const options = q.optionsText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .map((text, j) => ({ id: `o${j + 1}`, text }));
      return { id, type: "single", label: q.label, required: q.required, options };
    }
    return { id, type: "text", label: q.label, required: q.required };
  });
}

/** Constructor de la encuesta con editor dinámico de preguntas (task 3.1). */
export function SurveyForm({ courseId }: { courseId: string }) {
  const [state, formAction, pending] = useActionState<SurveyActionState, FormData>(createSurveyAction, {
    status: "idle",
  });
  const nextKey = useRef(1);
  const [questions, setQuestions] = useState<EditorQuestion[]>([]);

  const add = (type: EditorType): void => {
    const key = nextKey.current;
    nextKey.current += 1;
    setQuestions((qs) => [...qs, { key, type, label: "", required: true, scaleMax: 5, optionsText: "" }]);
  };
  const update = (key: number, patch: Partial<EditorQuestion>): void => {
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  };
  const remove = (key: number): void => setQuestions((qs) => qs.filter((q) => q.key !== key));

  const typeLabel: Record<EditorType, string> = {
    scale: t.typeScale,
    single: t.typeSingle,
    text: t.typeText,
  };

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="questions" value={JSON.stringify(buildQuestions(questions))} />

      <label className="flex flex-col gap-1 text-sm">
        {t.titleLabel}
        <input name="title" required className="input" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t.introLabel}
        <textarea name="intro" rows={2} className="input" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="anonymous" defaultChecked className="size-4" />
        {t.anonymousLabel}
      </label>

      <fieldset className="flex flex-col gap-3 border-t pt-4">
        <legend className="text-sm font-semibold">{t.questionsHeading}</legend>
        {questions.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.noQuestions}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {questions.map((q) => (
              <li key={q.key} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-neutral-100 px-2 py-0.5 dark:bg-neutral-800">{typeLabel[q.type]}</span>
                  <button
                    type="button"
                    onClick={() => remove(q.key)}
                    className="ml-auto min-h-11 text-red-600 underline"
                  >
                    {t.removeQuestion}
                  </button>
                </div>
                <label className="flex flex-col gap-1 text-sm">
                  {t.questionLabel}
                  <input
                    value={q.label}
                    onChange={(e) => update(q.key, { label: e.target.value })}
                    className="input"
                  />
                </label>
                {q.type === "scale" ? (
                  <label className="flex flex-col gap-1 text-sm sm:max-w-40">
                    {t.scaleMaxLabel}
                    <input
                      type="number"
                      min={2}
                      max={10}
                      value={q.scaleMax}
                      onChange={(e) => update(q.key, { scaleMax: Number(e.target.value) })}
                      className="input"
                    />
                  </label>
                ) : null}
                {q.type === "single" ? (
                  <label className="flex flex-col gap-1 text-sm">
                    {t.optionsLabel}
                    <textarea
                      rows={3}
                      value={q.optionsText}
                      onChange={(e) => update(q.key, { optionsText: e.target.value })}
                      className="input"
                    />
                  </label>
                ) : null}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={q.required}
                    onChange={(e) => update(q.key, { required: e.target.checked })}
                    className="size-4"
                  />
                  {t.requiredLabel}
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => add("scale")} className="min-h-11 rounded-md border px-3 text-sm">
            {t.addScale}
          </button>
          <button type="button" onClick={() => add("single")} className="min-h-11 rounded-md border px-3 text-sm">
            {t.addSingle}
          </button>
          <button type="button" onClick={() => add("text")} className="min-h-11 rounded-md border px-3 text-sm">
            {t.addText}
          </button>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-md bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
        >
          {t.save}
        </button>
        {state.status === "ok" ? <span className="text-sm text-green-700 dark:text-green-400">{t.saved}</span> : null}
        {state.status === "invalid" ? <span role="alert" className="text-sm text-red-600">{t.invalid}</span> : null}
        {state.status === "error" ? <span role="alert" className="text-sm text-red-600">{t.genericError}</span> : null}
      </div>
    </form>
  );
}
