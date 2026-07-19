"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldControl, FieldError, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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

      <FieldRoot invalid={!!err("title")}>
        <FieldLabel>{t.titleLabel}</FieldLabel>
        <FieldControl name="title" defaultValue={defaults?.title ?? ""} required />
        {err("title") ? <FieldError>{err("title")}</FieldError> : null}
      </FieldRoot>
      <FieldRoot>
        <FieldLabel>{t.descriptionLabel}</FieldLabel>
        <FieldControl name="description" defaultValue={defaults?.description ?? ""} render={<Textarea rows={2} />} />
      </FieldRoot>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRoot invalid={!!err("timeLimitMinutes")}>
          <FieldLabel>{t.timeLimitLabel}</FieldLabel>
          <FieldControl
            name="timeLimitMinutes"
            type="number"
            min={1}
            max={600}
            defaultValue={defaults?.timeLimitMinutes ?? ""}
          />
          {err("timeLimitMinutes") ? <FieldError>{err("timeLimitMinutes")}</FieldError> : null}
        </FieldRoot>
        <FieldRoot invalid={!!err("maxAttempts")}>
          <FieldLabel>{t.maxAttemptsLabel}</FieldLabel>
          <FieldControl name="maxAttempts" type="number" min={1} max={50} defaultValue={defaults?.maxAttempts ?? ""} />
          {err("maxAttempts") ? <FieldError>{err("maxAttempts")}</FieldError> : null}
        </FieldRoot>
        <FieldRoot>
          <FieldLabel>{t.scoringLabel}</FieldLabel>
          <Select name="attemptScoring" defaultValue={defaults?.attemptScoring ?? "best"}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="best">{t.scoringBest}</SelectItem>
              <SelectItem value="last">{t.scoringLast}</SelectItem>
              <SelectItem value="average">{t.scoringAverage}</SelectItem>
            </SelectContent>
          </Select>
        </FieldRoot>
        <FieldRoot invalid={!!err("passingPct")}>
          <FieldLabel>{t.passingLabel}</FieldLabel>
          <FieldControl name="passingPct" type="number" min={1} max={99} defaultValue={defaults?.passingPct ?? 60} />
          {err("passingPct") ? <FieldError>{err("passingPct")}</FieldError> : null}
        </FieldRoot>
        <FieldRoot invalid={!!err("poolSize")}>
          <FieldLabel>{t.poolLabel}</FieldLabel>
          <FieldControl name="poolSize" type="number" min={1} defaultValue={defaults?.poolSize ?? ""} />
          {err("poolSize") ? <FieldError>{err("poolSize")}</FieldError> : null}
        </FieldRoot>
        <FieldRoot invalid={!!err("weight")}>
          <FieldLabel>{t.weightLabel}</FieldLabel>
          <FieldControl name="weight" type="number" min={0} step="0.5" defaultValue={defaults?.weight ?? 1} />
          {err("weight") ? <FieldError>{err("weight")}</FieldError> : null}
        </FieldRoot>
        <FieldRoot>
          <FieldLabel>{t.reviewLabel}</FieldLabel>
          <Select name="reviewPolicy" defaultValue={defaults?.reviewPolicy ?? "after_submit"}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="never">{t.reviewNever}</SelectItem>
              <SelectItem value="after_submit">{t.reviewAfterSubmit}</SelectItem>
              <SelectItem value="after_close">{t.reviewAfterClose}</SelectItem>
            </SelectContent>
          </Select>
        </FieldRoot>
      </div>

      <Label>
        <Checkbox name="shuffleQuestions" value="true" defaultChecked={defaults?.shuffleQuestions ?? true} />
        {t.shuffleQuestions}
      </Label>
      <Label>
        <Checkbox name="shuffleChoices" value="true" defaultChecked={defaults?.shuffleChoices ?? true} />
        {t.shuffleChoices}
      </Label>

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
