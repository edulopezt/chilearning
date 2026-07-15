import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listQuizzesByCourse } from "@/modules/evaluacion/quiz-service";
import { QuizForm } from "./quiz-form";
import { publishQuizAction, deleteQuizAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.quizzes;

/** Lista de evaluaciones del curso + creación (task 2.1, HU-6.1). */
export default async function EvaluacionesPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
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

  const { courseId } = await params;
  const quizzes = await listQuizzesByCourse(principal, courseId);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      <section className="flex flex-col gap-3">
        {quizzes.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {quizzes.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                <span className="flex-1 font-medium">{q.title}</span>
                <span className="text-muted-foreground text-sm">
                  {q.questionCount} {t.colQuestions.toLowerCase()}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    q.status === "published"
                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                      : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                  }`}
                >
                  {q.status === "published" ? t.statusPublished : t.statusDraft}
                </span>
                <Link
                  href={`/admin/cursos/${courseId}/evaluaciones/quiz/${q.id}`}
                  className="text-sm underline"
                >
                  {t.edit}
                </Link>
                <form action={publishQuizAction}>
                  <input type="hidden" name="quizId" value={q.id} />
                  <input type="hidden" name="courseId" value={courseId} />
                  <input type="hidden" name="publish" value={q.status === "published" ? "false" : "true"} />
                  <button type="submit" className="text-sm underline">
                    {q.status === "published" ? t.unpublish : t.publish}
                  </button>
                </form>
                {q.status === "draft" ? (
                  <form action={deleteQuizAction}>
                    <input type="hidden" name="quizId" value={q.id} />
                    <input type="hidden" name="courseId" value={courseId} />
                    <button type="submit" className="text-sm text-red-600 underline">
                      {t.deleteQuiz}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t pt-6">
        <h2 className="text-lg font-semibold">{t.newQuiz}</h2>
        <QuizForm courseId={courseId} />
      </section>

      <p>
        <Link href={`/admin/cursos/${courseId}/lecciones`} className="text-sm underline">
          ← {esCL.lessons.title}
        </Link>
      </p>
    </main>
  );
}
