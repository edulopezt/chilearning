import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { getQuiz, listQuestions } from "@/modules/evaluacion/quiz-service";
import { QuizForm } from "../../quiz-form";
import { QuestionEditor } from "../../question-editor";
import { deleteQuestionAction } from "../../actions";

export const dynamic = "force-dynamic";

const t = esCL.quizzes;

const KIND_LABEL: Record<string, string> = {
  multiple_choice: t.kindMc,
  true_false: t.kindTf,
  matching: t.kindMatching,
};

/** Editor de un quiz: configuración + banco de preguntas (task 2.1). */
export default async function QuizEditorPage({
  params,
}: {
  params: Promise<{ courseId: string; quizId: string }>;
}) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (
    !principal.tenantId ||
    !authorize(principal, principal.tenantId, ["otec_admin", "coordinator", "instructor"])
  ) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.forbidden}</p>
      </main>
    );
  }

  const { courseId, quizId } = await params;
  const quiz = await getQuiz(principal, quizId);
  if (!quiz) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.genericError}</p>
      </main>
    );
  }
  const questions = await listQuestions(principal, quizId);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{quiz.title}</h1>
        <p className="text-muted-foreground text-sm">
          {quiz.status === "published" ? t.statusPublished : t.statusDraft}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <QuizForm
          courseId={courseId}
          defaults={{
            quizId: quiz.id,
            title: quiz.title,
            description: quiz.description,
            timeLimitMinutes: quiz.time_limit_minutes,
            maxAttempts: quiz.max_attempts,
            attemptScoring: quiz.attempt_scoring,
            passingPct: quiz.passing_pct,
            poolSize: quiz.pool_size,
            shuffleQuestions: quiz.shuffle_questions,
            shuffleChoices: quiz.shuffle_choices,
            reviewPolicy: quiz.review_policy,
            weight: quiz.weight,
          }}
        />
      </section>

      <section className="flex flex-col gap-3 border-t pt-6">
        <h2 className="text-lg font-semibold">
          {t.questionsTitle} ({questions.length})
        </h2>
        {questions.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.noQuestions}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {questions.map((q, i) => (
              <li key={q.id} className="flex items-start gap-3 rounded-md border p-3">
                <span className="text-muted-foreground font-mono text-sm">{i + 1}</span>
                <div className="flex flex-1 flex-col">
                  <span className="text-sm font-medium">{q.prompt}</span>
                  <span className="text-muted-foreground text-xs">
                    {KIND_LABEL[q.kind]} · {q.points} {esCL.quizStudent.points}
                  </span>
                </div>
                <form action={deleteQuestionAction}>
                  <input type="hidden" name="questionId" value={q.id} />
                  <input type="hidden" name="quizId" value={quizId} />
                  <input type="hidden" name="courseId" value={courseId} />
                  <button type="submit" className="text-sm text-red-600 underline">
                    {t.removeQuestion}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <QuestionEditor key={questions.length} courseId={courseId} quizId={quizId} />
      </section>

      <p>
        <Link href={`/admin/cursos/${courseId}/evaluaciones`} className="text-sm underline">
          ← {t.title}
        </Link>
      </p>
    </main>
  );
}
