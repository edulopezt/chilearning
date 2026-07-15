"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import { createQuizAction, updateQuizAction, type QuizActionState } from "./actions";

const t = esCL.quizzes;

interface QuizDefaults {
  quizId?: string;
  title: string;
  description: string;
  timeLimitMinutes: number | null;
  maxAttempts: number | null;
  attemptScoring: string;
  passingPct: number;
  poolSize: number | null;
  shuffleQuestions: boolean;
  shuffleChoices: boolean;
  reviewPolicy: string;
  weight: number;
}

/** Form de creación/edición de un quiz (config S1–S13). */
export function QuizForm({
  courseId,
  defaults,
}: {
  courseId: string;
  defaults?: QuizDefaults;
}) {
  const isEdit = Boolean(defaults?.quizId);
  const [state, formAction, pending] = useActionState<QuizActionState, FormData>(
    isEdit ? updateQuizAction : createQuizAction,
    { status: "idle" },
  );
  const err = (field: string): string | undefined =>
    state.status === "invalid" ? state.errors.find((e) => e.field === field)?.message : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="courseId" value={courseId} />
      {defaults?.quizId ? <input type="hidden" name="quizId" value={defaults.quizId} /> : null}

      <Field label={t.titleLabel} error={err("title")}>
        <input name="title" defaultValue={defaults?.title ?? ""} required className="input" />
      </Field>
      <Field label={t.descriptionLabel}>
        <textarea name="description" defaultValue={defaults?.description ?? ""} className="input" rows={2} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.timeLimitLabel} error={err("timeLimitMinutes")}>
          <input name="timeLimitMinutes" type="number" min={1} max={600} defaultValue={defaults?.timeLimitMinutes ?? ""} className="input" />
        </Field>
        <Field label={t.maxAttemptsLabel} error={err("maxAttempts")}>
          <input name="maxAttempts" type="number" min={1} max={50} defaultValue={defaults?.maxAttempts ?? ""} className="input" />
        </Field>
        <Field label={t.scoringLabel}>
          <select name="attemptScoring" defaultValue={defaults?.attemptScoring ?? "best"} className="input">
            <option value="best">{t.scoringBest}</option>
            <option value="last">{t.scoringLast}</option>
            <option value="average">{t.scoringAverage}</option>
          </select>
        </Field>
        <Field label={t.passingLabel} error={err("passingPct")}>
          <input name="passingPct" type="number" min={1} max={99} defaultValue={defaults?.passingPct ?? 60} className="input" />
        </Field>
        <Field label={t.poolLabel} error={err("poolSize")}>
          <input name="poolSize" type="number" min={1} defaultValue={defaults?.poolSize ?? ""} className="input" />
        </Field>
        <Field label={t.weightLabel} error={err("weight")}>
          <input name="weight" type="number" min={0} step="0.5" defaultValue={defaults?.weight ?? 1} className="input" />
        </Field>
        <Field label={t.reviewLabel}>
          <select name="reviewPolicy" defaultValue={defaults?.reviewPolicy ?? "after_submit"} className="input">
            <option value="never">{t.reviewNever}</option>
            <option value="after_submit">{t.reviewAfterSubmit}</option>
            <option value="after_close">{t.reviewAfterClose}</option>
          </select>
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="shuffleQuestions" defaultChecked={defaults?.shuffleQuestions ?? true} className="min-h-5 min-w-5" />
        {t.shuffleQuestions}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="shuffleChoices" defaultChecked={defaults?.shuffleChoices ?? true} className="min-h-5 min-w-5" />
        {t.shuffleChoices}
      </label>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="min-h-11 rounded-md bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900">
          {t.save}
        </button>
        {state.status === "ok" ? <span className="text-sm text-green-700 dark:text-green-400">{t.saved}</span> : null}
        {state.status === "error" ? <span role="alert" className="text-sm text-red-600">{t.genericError}</span> : null}
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      {children}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </label>
  );
}
