import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listSurveysByCourse } from "@/modules/evaluacion/survey-service";
import { SurveyForm } from "./survey-form";
import { publishSurveyAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.surveys;

/** Gestión de la encuesta de satisfacción del curso (task 3.1, HU-6.3). */
export default async function EncuestaPage({
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
  const surveys = await listSurveysByCourse(principal, courseId);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      <section className="flex flex-col gap-2">
        {surveys.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {surveys.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                <span className="flex-1 font-medium">{s.title}</span>
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                  {s.anonymous ? t.anonymousBadge : t.nominalBadge}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    s.status === "published"
                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                      : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                  }`}
                >
                  {s.status === "published" ? t.statusPublished : t.statusDraft}
                </span>
                <form action={publishSurveyAction}>
                  <input type="hidden" name="surveyId" value={s.id} />
                  <input type="hidden" name="courseId" value={courseId} />
                  <input type="hidden" name="publish" value={s.status === "published" ? "false" : "true"} />
                  <button type="submit" className="min-h-11 text-sm underline">
                    {s.status === "published" ? t.unpublish : t.publish}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t pt-6">
        <h2 className="text-lg font-semibold">{t.newSurvey}</h2>
        <SurveyForm courseId={courseId} />
      </section>

      <p className="flex gap-4">
        <Link href={`/admin/cursos/${courseId}/tareas`} className="text-sm underline">
          ← {t.lessonsLink}
        </Link>
      </p>
    </main>
  );
}
