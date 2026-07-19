"use client";

import { useActionState, useState } from "react";
import { XIcon } from "lucide-react";

import { esCL } from "@/i18n/es-CL";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldControl, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createQuestionAction, type QuizActionState } from "./actions";

const t = esCL.quizzes;

type Kind = "multiple_choice" | "true_false" | "matching";

interface Choice {
  id: string;
  text: string;
  correct: boolean;
}
interface Pair {
  id: string;
  left: string;
  right: string;
}

/**
 * Editor de una nueva pregunta: cambia los campos según el tipo y serializa el
 * `body` a un input oculto JSON (la Server Action lo valida con el dominio).
 */
export function QuestionEditor({ courseId, quizId }: { courseId: string; quizId: string }) {
  const [state, formAction, pending] = useActionState<QuizActionState, FormData>(
    createQuestionAction,
    { status: "idle" },
  );
  const [kind, setKind] = useState<Kind>("multiple_choice");
  const [choices, setChoices] = useState<Choice[]>([
    { id: "c1", text: "", correct: true },
    { id: "c2", text: "", correct: false },
  ]);
  const [tfCorrect, setTfCorrect] = useState(true);
  const [pairs, setPairs] = useState<Pair[]>([
    { id: "p1", left: "", right: "" },
    { id: "p2", left: "", right: "" },
  ]);

  const body =
    kind === "multiple_choice"
      ? { choices }
      : kind === "true_false"
        ? { correct: tfCorrect }
        : { pairs };

  const fieldErr =
    state.status === "invalid" ? state.errors.map((e) => e.message).join(" · ") : null;

  return (
    <form
      action={(fd) => {
        // La UI se reinicia con `key` desde el server tras revalidar; aquí solo
        // se serializa el body actual.
        fd.set("body", JSON.stringify(body));
        return formAction(fd);
      }}
      className="flex flex-col gap-4 rounded-lg border p-4"
    >
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="quizId" value={quizId} />
      <input type="hidden" name="kind" value={kind} />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <FieldRoot>
          <FieldLabel>{t.questionKindLabel}</FieldLabel>
          <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="multiple_choice">{t.kindMc}</SelectItem>
              <SelectItem value="true_false">{t.kindTf}</SelectItem>
              <SelectItem value="matching">{t.kindMatching}</SelectItem>
            </SelectContent>
          </Select>
        </FieldRoot>
        <FieldRoot>
          <FieldLabel>{t.pointsLabel}</FieldLabel>
          <FieldControl name="points" type="number" min={0.5} step="0.5" defaultValue={1} className="w-24" />
        </FieldRoot>
      </div>

      <FieldRoot>
        <FieldLabel>{t.promptLabel}</FieldLabel>
        <FieldControl name="prompt" required render={<Textarea rows={2} />} />
      </FieldRoot>

      {kind === "multiple_choice" ? (
        <fieldset className="flex flex-col gap-2">
          <RadioGroup
            value={choices.find((c) => c.correct)?.id}
            onValueChange={(id) =>
              setChoices((prev) => prev.map((x) => ({ ...x, correct: x.id === id })))
            }
            className="gap-2"
          >
            {choices.map((c, i) => (
              <div key={c.id} className="flex items-center gap-2">
                <RadioGroupItem value={c.id} aria-label={t.correctLabel} />
                <Input
                  value={c.text}
                  onChange={(e) =>
                    setChoices((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                  }
                  placeholder={`${t.choiceLabel} ${i + 1}`}
                  className="flex-1"
                />
                {choices.length > 2 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="✕"
                    onClick={() => setChoices((prev) => prev.filter((_, j) => j !== i))}
                    className="text-destructive"
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </div>
            ))}
          </RadioGroup>
          {choices.length < 8 ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto self-start p-0"
              onClick={() =>
                setChoices((prev) => [...prev, { id: `c${prev.length + 1}`, text: "", correct: false }])
              }
            >
              {t.addChoice}
            </Button>
          ) : null}
        </fieldset>
      ) : null}

      {kind === "true_false" ? (
        <Label>
          <Checkbox checked={tfCorrect} onCheckedChange={setTfCorrect} />
          {t.tfCorrectLabel}
        </Label>
      ) : null}

      {kind === "matching" ? (
        <fieldset className="flex flex-col gap-2">
          {pairs.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2">
              <Input
                value={p.left}
                onChange={(e) =>
                  setPairs((prev) => prev.map((x, j) => (j === i ? { ...x, left: e.target.value } : x)))
                }
                placeholder={t.pairLeft}
                className="flex-1"
              />
              <span aria-hidden>→</span>
              <Input
                value={p.right}
                onChange={(e) =>
                  setPairs((prev) => prev.map((x, j) => (j === i ? { ...x, right: e.target.value } : x)))
                }
                placeholder={t.pairRight}
                className="flex-1"
              />
              {pairs.length > 2 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="✕"
                  onClick={() => setPairs((prev) => prev.filter((_, j) => j !== i))}
                  className="text-destructive"
                >
                  <XIcon />
                </Button>
              ) : null}
            </div>
          ))}
          {pairs.length < 10 ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto self-start p-0"
              onClick={() =>
                setPairs((prev) => [...prev, { id: `p${prev.length + 1}`, left: "", right: "" }])
              }
            >
              {t.addPair}
            </Button>
          ) : null}
        </fieldset>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" loading={pending}>
          {t.addQuestion}
        </Button>
        {fieldErr ? <span role="alert" className="text-sm text-destructive">{fieldErr}</span> : null}
      </div>
    </form>
  );
}
