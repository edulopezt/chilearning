"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import type { QuestionSnapshot } from "@/modules/evaluacion/domain/grading";
import { saveAnswersAction, submitAttemptAction } from "./actions";

const t = esCL.quizStudent;

/**
 * Ejecuta un intento en curso: renderiza el snapshot (sin pauta), autosalva las
 * respuestas con debounce, cuenta el tiempo restante y auto-envía al llegar a
 * 0 (S6). El servidor es la autoridad: al vencer, corrige lo AUTOSALVADO.
 */
export function AttemptRunner({
  quizId,
  attemptId,
  snapshot,
  initialAnswers,
  expiresAtMs,
}: {
  quizId: string;
  attemptId: string;
  snapshot: QuestionSnapshot[];
  initialAnswers: Record<string, unknown>;
  expiresAtMs: number | null;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, unknown>>(initialAnswers);
  const [saved, setSaved] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();
  // null hasta el primer tick del effect (Date.now() es impuro fuera de effects).
  const [remaining, setRemaining] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittedRef = useRef(false);

  const doSubmit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    await submitAttemptAction(quizId, attemptId, answers);
    startTransition(() => router.refresh());
  }, [quizId, attemptId, answers, router]);

  // Autosave con debounce de 800 ms.
  const scheduleSave = useCallback(
    (next: Record<string, unknown>) => {
      setSaved(false);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void saveAnswersAction(attemptId, next).then((r) => setSaved(r.ok));
      }, 800);
    },
    [attemptId],
  );

  const setAnswer = useCallback(
    (questionId: string, value: unknown) => {
      setAnswers((prev) => {
        const next = { ...prev, [questionId]: value };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  // Cuenta regresiva + auto-envío al llegar a 0.
  useEffect(() => {
    if (expiresAtMs === null) return;
    const tick = () => {
      const ms = Math.max(0, expiresAtMs - Date.now());
      setRemaining(ms);
      if (ms <= 0) void doSubmit();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAtMs, doSubmit]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{saved ? t.autosaved : "…"}</span>
        {remaining !== null ? (
          <span className={`font-mono font-semibold ${remaining < 60_000 ? "text-red-600" : ""}`}>
            {t.timeLeft}: {formatMs(remaining)}
          </span>
        ) : null}
      </div>

      <ol className="flex flex-col gap-6">
        {snapshot.map((q, i) => (
          <li key={q.id} className="flex flex-col gap-3 rounded-md border p-4">
            <p className="font-medium">
              {i + 1}. {q.prompt}{" "}
              <span className="text-muted-foreground text-xs">
                ({q.points} {t.points})
              </span>
            </p>
            <QuestionInput question={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => void doSubmit()}
        disabled={submitting}
        className="min-h-11 self-start rounded-md bg-neutral-900 px-5 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
      >
        {submitting ? t.submitting : t.submit}
      </button>
    </div>
  );
}

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: QuestionSnapshot;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (question.kind === "multiple_choice") {
    return (
      <div className="flex flex-col gap-2">
        {question.choices.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={question.id}
              checked={value === c.id}
              onChange={() => onChange(c.id)}
              className="min-h-5 min-w-5"
            />
            {c.text}
          </label>
        ))}
      </div>
    );
  }

  if (question.kind === "true_false") {
    return (
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name={question.id} checked={value === true} onChange={() => onChange(true)} className="min-h-5 min-w-5" />
          {t.tfTrue}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name={question.id} checked={value === false} onChange={() => onChange(false)} className="min-h-5 min-w-5" />
          {t.tfFalse}
        </label>
      </div>
    );
  }

  // matching: por cada lado izquierdo, un select del lado derecho.
  const current = (typeof value === "object" && value !== null ? value : {}) as Record<string, string>;
  return (
    <div className="flex flex-col gap-2">
      {question.lefts.map((left) => (
        <div key={left.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-32 flex-1">{left.text}</span>
          <span aria-hidden>→</span>
          <select
            value={current[left.id] ?? ""}
            onChange={(e) => onChange({ ...current, [left.id]: e.target.value })}
            className="input flex-1"
          >
            <option value="">{t.matchSelect}</option>
            {question.rights.map((right) => (
              <option key={right.id} value={right.id}>
                {right.text}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
