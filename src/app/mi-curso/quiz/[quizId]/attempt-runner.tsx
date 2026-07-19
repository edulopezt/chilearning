"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import type { QuestionSnapshot } from "@/modules/evaluacion/domain/grading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
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
        <span role="status" className="text-muted-foreground">
          {saved ? t.autosaved : "…"}
        </span>
        {remaining !== null ? (
          <span className={cn("font-mono font-semibold", remaining < 60_000 && "text-destructive")}>
            {t.timeLeft}: {formatMs(remaining)}
          </span>
        ) : null}
      </div>

      <ol className="flex flex-col gap-6">
        {snapshot.map((q, i) => (
          <li key={q.id}>
            <Card className="gap-3 p-4">
              <p className="font-medium">
                {i + 1}. {q.prompt}{" "}
                <span className="text-xs text-muted-foreground">
                  ({q.points} {t.points})
                </span>
              </p>
              <QuestionInput question={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
            </Card>
          </li>
        ))}
      </ol>

      <Button type="button" size="lg" onClick={() => void doSubmit()} loading={submitting} className="self-start">
        {submitting ? t.submitting : t.submit}
      </Button>
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
              className="size-5 accent-primary"
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
          <input
            type="radio"
            name={question.id}
            checked={value === true}
            onChange={() => onChange(true)}
            className="size-5 accent-primary"
          />
          {t.tfTrue}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={question.id}
            checked={value === false}
            onChange={() => onChange(false)}
            className="size-5 accent-primary"
          />
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
          <Select
            value={current[left.id] ?? null}
            onValueChange={(v) => onChange({ ...current, [left.id]: v })}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder={t.matchSelect} />
            </SelectTrigger>
            <SelectContent>
              {question.rights.map((right) => (
                <SelectItem key={right.id} value={right.id}>
                  {right.text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
