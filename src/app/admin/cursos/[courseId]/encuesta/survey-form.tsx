"use client";

import { useRef, useState } from "react";
import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldControl, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

      <FieldRoot>
        <FieldLabel>{t.titleLabel}</FieldLabel>
        <FieldControl name="title" required />
      </FieldRoot>
      <FieldRoot>
        <FieldLabel>{t.introLabel}</FieldLabel>
        <FieldControl name="intro" render={<Textarea rows={2} />} />
      </FieldRoot>
      <Label>
        <Checkbox name="anonymous" value="true" defaultChecked />
        {t.anonymousLabel}
      </Label>

      <fieldset className="flex flex-col gap-3 border-t pt-4">
        <legend className="text-sm font-semibold">{t.questionsHeading}</legend>
        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noQuestions}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {questions.map((q) => (
              <li key={q.key} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{typeLabel[q.type]}</Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(q.key)}
                    className="ml-auto text-destructive"
                  >
                    {t.removeQuestion}
                  </Button>
                </div>
                <FieldRoot>
                  <FieldLabel>{t.questionLabel}</FieldLabel>
                  <FieldControl value={q.label} onChange={(e) => update(q.key, { label: e.target.value })} />
                </FieldRoot>
                {q.type === "scale" ? (
                  <FieldRoot className="sm:max-w-40">
                    <FieldLabel>{t.scaleMaxLabel}</FieldLabel>
                    <FieldControl
                      type="number"
                      min={2}
                      max={10}
                      value={q.scaleMax}
                      onChange={(e) => update(q.key, { scaleMax: Number(e.target.value) })}
                    />
                  </FieldRoot>
                ) : null}
                {q.type === "single" ? (
                  <FieldRoot>
                    <FieldLabel>{t.optionsLabel}</FieldLabel>
                    <FieldControl
                      render={
                        <Textarea
                          rows={3}
                          value={q.optionsText}
                          onChange={(e) => update(q.key, { optionsText: e.target.value })}
                        />
                      }
                    />
                  </FieldRoot>
                ) : null}
                <Label>
                  <Checkbox checked={q.required} onCheckedChange={(v) => update(q.key, { required: v })} />
                  {t.requiredLabel}
                </Label>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => add("scale")}>
            {t.addScale}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => add("single")}>
            {t.addSingle}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => add("text")}>
            {t.addText}
          </Button>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>
          {t.save}
        </Button>
        {state.status === "ok" ? (
          <Alert variant="success" role="status" className="w-auto py-2">
            <AlertDescription>{t.saved}</AlertDescription>
          </Alert>
        ) : null}
        {state.status === "invalid" ? (
          <Alert variant="destructive" role="alert" className="w-auto py-2">
            <AlertDescription>{t.invalid}</AlertDescription>
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
