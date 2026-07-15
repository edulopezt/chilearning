import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getAttemptReview, getStudentQuizState } from "@/modules/evaluacion/attempt-service";
import { StartAttemptButton } from "./start-button";
import { AttemptRunner } from "./attempt-runner";

export const dynamic = "force-dynamic";

const t = esCL.quizStudent;

const START_DENIED: Record<string, string> = {
  closed: t.reasonClosed,
  not_open: t.reasonNotOpen,
  no_attempts_left: t.reasonNoAttempts,
  no_questions: t.reasonNoQuestions,
  not_published: t.unavailable,
  already_open: "",
};

/** Flujo del alumno para una evaluación (task 2.1, HU-6.1). */
export default async function StudentQuizPage({
  params,
}: {
  params: Promise<{ quizId: string }>;
}) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const { quizId } = await params;
  const state = await getStudentQuizState(principal, quizId);
  if (!state.ok) {
    return (
      <Shell>
        <p className="text-muted-foreground">
          {state.error === "not_enrolled" ? t.notEnrolled : t.notFound}
        </p>
      </Shell>
    );
  }

  const openAttempt = state.attempts.find((a) => a.status === "in_progress");
  const lastFinished = [...state.attempts].reverse().find((a) => a.status !== "in_progress");

  // Intento en curso: correr el runner.
  if (openAttempt) {
    return (
      <Shell>
        <h2 className="text-lg font-semibold">{t.attemptTitle}</h2>
        <AttemptRunner
          quizId={quizId}
          attemptId={openAttempt.attemptId}
          snapshot={[...openAttempt.snapshot]}
          initialAnswers={{ ...openAttempt.answers }}
          expiresAtMs={openAttempt.expiresAt ? Date.parse(openAttempt.expiresAt) : null}
        />
      </Shell>
    );
  }

  // Sin intento abierto: resultado del último + botón de (re)intento.
  const review =
    lastFinished !== undefined
      ? await getAttemptReview(principal, lastFinished.attemptId)
      : null;

  return (
    <Shell>
      {lastFinished ? (
        <section className="flex flex-col gap-2 rounded-md border p-4">
          <h2 className="text-lg font-semibold">{t.resultTitle}</h2>
          {lastFinished.status === "expired" ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">{t.expiredNote}</p>
          ) : null}
          <p className="text-3xl font-bold">
            {t.yourGrade}: {lastFinished.grade?.toFixed(1) ?? "—"}
          </p>
          <p className="text-muted-foreground text-sm">
            {t.yourScore}: {lastFinished.score ?? 0} / {lastFinished.maxScore}
          </p>
        </section>
      ) : null}

      {review?.ok ? (
        <section className="flex flex-col gap-3">
          <h3 className="font-semibold">{t.reviewTitle}</h3>
          {review.attempt.snapshot.map((q, i) => {
            const key = review.answerKey[q.id];
            return (
              <div key={q.id} className="rounded-md border p-3 text-sm">
                <p className="font-medium">
                  {i + 1}. {q.prompt}
                </p>
                <p className="text-muted-foreground">
                  {t.correctAnswer}: <CorrectAnswer question={q} keyEntry={key} />
                </p>
              </div>
            );
          })}
        </section>
      ) : null}

      {state.canStart.ok ? (
        <StartAttemptButton
          quizId={quizId}
          label={state.attempts.length > 0 ? t.continue : t.start}
        />
      ) : START_DENIED[state.canStart.reason] ? (
        <p className="text-muted-foreground text-sm">{START_DENIED[state.canStart.reason]}</p>
      ) : null}

      <p>
        <Link href="/mi-curso" className="text-sm underline">
          ← {t.backToCourse}
        </Link>
      </p>
    </Shell>
  );
}

function CorrectAnswer({
  question,
  keyEntry,
}: {
  question: import("@/modules/evaluacion/domain/grading").QuestionSnapshot;
  keyEntry: import("@/modules/evaluacion/domain/grading").AnswerKeyEntry | undefined;
}) {
  if (!keyEntry) return <span>—</span>;
  if (keyEntry.kind === "true_false") return <span>{keyEntry.correct ? t.tfTrue : t.tfFalse}</span>;
  if (keyEntry.kind === "multiple_choice" && question.kind === "multiple_choice") {
    return <span>{question.choices.find((c) => c.id === keyEntry.correctChoiceId)?.text ?? "—"}</span>;
  }
  if (keyEntry.kind === "matching" && question.kind === "matching") {
    const rightText = (id: string) => question.rights.find((r) => r.id === id)?.text ?? id;
    const leftText = (id: string) => question.lefts.find((l) => l.id === id)?.text ?? id;
    return (
      <span>
        {Object.entries(keyEntry.pairs)
          .map(([l, r]) => `${leftText(l)} → ${rightText(r)}`)
          .join(" · ")}
      </span>
    );
  }
  return <span>—</span>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      {children}
    </main>
  );
}
