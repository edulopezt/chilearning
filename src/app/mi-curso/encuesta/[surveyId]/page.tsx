import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getStudentSurvey } from "@/modules/evaluacion/survey-service";
import { SurveyAnswerForm } from "./survey-answer-form";

export const dynamic = "force-dynamic";

const t = esCL.surveyStudent;

/** El alumno responde la encuesta de satisfacción (task 3.1, HU-6.3). */
export default async function StudentSurveyPage({
  params,
}: {
  params: Promise<{ surveyId: string }>;
}) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const { surveyId } = await params;
  const view = await getStudentSurvey(principal, surveyId);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      {!view ? (
        <div className="flex flex-1 flex-col justify-center gap-4">
          <p className="text-muted-foreground">{t.notAvailable}</p>
          <Link href="/mi-curso" className="text-sm underline">
            {t.backToCourse}
          </Link>
        </div>
      ) : (
        <>
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">{view.survey.title}</h1>
            <p className="text-muted-foreground text-sm">{view.survey.intro || t.intro}</p>
            {view.survey.anonymous ? (
              <p className="text-sm text-green-700 dark:text-green-400">{t.anonymousNote}</p>
            ) : null}
          </header>

          {view.alreadySubmitted ? (
            <div className="flex flex-col gap-4 rounded-lg border p-6 text-center">
              <p className="text-lg font-medium text-green-700 dark:text-green-400">{t.alreadyDone}</p>
              <Link href="/mi-curso" className="text-sm underline">
                {t.backToCourse}
              </Link>
            </div>
          ) : (
            <SurveyAnswerForm surveyId={view.survey.id} questions={view.survey.questions} />
          )}
        </>
      )}
    </main>
  );
}
