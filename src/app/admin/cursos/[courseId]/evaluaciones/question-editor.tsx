"use client";

import { useActionState, useState } from "react";

import { esCL } from "@/i18n/es-CL";
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
      className="flex flex-col gap-4 rounded-md border p-4"
    >
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="quizId" value={quizId} />
      <input type="hidden" name="kind" value={kind} />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="flex flex-col gap-1 text-sm">
          {t.questionKindLabel}
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            className="input"
          >
            <option value="multiple_choice">{t.kindMc}</option>
            <option value="true_false">{t.kindTf}</option>
            <option value="matching">{t.kindMatching}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.pointsLabel}
          <input name="points" type="number" min={0.5} step="0.5" defaultValue={1} className="input w-24" />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        {t.promptLabel}
        <textarea name="prompt" required rows={2} className="input" />
      </label>

      {kind === "multiple_choice" ? (
        <fieldset className="flex flex-col gap-2">
          {choices.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2">
              <input
                type="radio"
                name="mc-correct"
                checked={c.correct}
                onChange={() =>
                  setChoices((prev) => prev.map((x, j) => ({ ...x, correct: j === i })))
                }
                aria-label={t.correctLabel}
                className="min-h-5 min-w-5"
              />
              <input
                value={c.text}
                onChange={(e) =>
                  setChoices((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                }
                placeholder={`${t.choiceLabel} ${i + 1}`}
                className="input flex-1"
              />
              {choices.length > 2 ? (
                <button
                  type="button"
                  onClick={() => setChoices((prev) => prev.filter((_, j) => j !== i))}
                  className="text-sm text-red-600"
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
          {choices.length < 8 ? (
            <button
              type="button"
              onClick={() =>
                setChoices((prev) => [...prev, { id: `c${prev.length + 1}`, text: "", correct: false }])
              }
              className="self-start text-sm underline"
            >
              {t.addChoice}
            </button>
          ) : null}
        </fieldset>
      ) : null}

      {kind === "true_false" ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={tfCorrect}
            onChange={(e) => setTfCorrect(e.target.checked)}
            className="min-h-5 min-w-5"
          />
          {t.tfCorrectLabel}
        </label>
      ) : null}

      {kind === "matching" ? (
        <fieldset className="flex flex-col gap-2">
          {pairs.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2">
              <input
                value={p.left}
                onChange={(e) =>
                  setPairs((prev) => prev.map((x, j) => (j === i ? { ...x, left: e.target.value } : x)))
                }
                placeholder={t.pairLeft}
                className="input flex-1"
              />
              <span aria-hidden>→</span>
              <input
                value={p.right}
                onChange={(e) =>
                  setPairs((prev) => prev.map((x, j) => (j === i ? { ...x, right: e.target.value } : x)))
                }
                placeholder={t.pairRight}
                className="input flex-1"
              />
              {pairs.length > 2 ? (
                <button
                  type="button"
                  onClick={() => setPairs((prev) => prev.filter((_, j) => j !== i))}
                  className="text-sm text-red-600"
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
          {pairs.length < 10 ? (
            <button
              type="button"
              onClick={() =>
                setPairs((prev) => [...prev, { id: `p${prev.length + 1}`, left: "", right: "" }])
              }
              className="self-start text-sm underline"
            >
              {t.addPair}
            </button>
          ) : null}
        </fieldset>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-md border px-4 font-medium disabled:opacity-60"
        >
          {t.addQuestion}
        </button>
        {fieldErr ? <span role="alert" className="text-sm text-red-600">{fieldErr}</span> : null}
      </div>
    </form>
  );
}
