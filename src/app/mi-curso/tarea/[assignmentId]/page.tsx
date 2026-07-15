import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getStudentAssignmentView } from "@/modules/evaluacion/assignment-service";
import { SubmitForm } from "./submit-form";
import { DownloadLink } from "./download-link";

export const dynamic = "force-dynamic";

const t = esCL.assignmentStudent;

/** Vista del alumno de una tarea: instrucciones, entregas, nota y entrega. */
export default async function StudentAssignmentPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const { assignmentId } = await params;
  const view = await getStudentAssignmentView(principal, assignmentId);
  if (!view) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.notFound}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{view.assignment.title}</h1>
        <p className="text-muted-foreground text-sm">
          {view.assignment.dueAt
            ? `${t.due}: ${new Date(view.assignment.dueAt).toLocaleString("es-CL")}`
            : t.noDue}
        </p>
      </header>

      {view.assignment.instructions ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{view.assignment.instructions}</p>
      ) : null}

      {view.grade ? (
        <section className="flex flex-col gap-1 rounded-md border p-4">
          <p className="text-2xl font-bold">
            {t.yourGrade}: {view.grade.grade.toFixed(1)}
          </p>
          {view.grade.feedback ? (
            <p className="text-sm">
              <span className="text-muted-foreground">{t.feedbackLabel}: </span>
              {view.grade.feedback}
            </p>
          ) : null}
        </section>
      ) : view.submissions.length > 0 ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">{t.pending}</p>
      ) : null}

      {view.submissions.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t.historyTitle}</h3>
          <ul className="flex flex-col gap-2">
            {view.submissions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
                <span className="font-medium">
                  {t.version} {s.version}
                </span>
                <span className="text-muted-foreground">{s.file_name}</span>
                {s.late ? (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                    {t.lateBadge}
                  </span>
                ) : null}
                <span className="flex-1" />
                <DownloadLink submissionId={s.id} label={t.download} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <SubmitForm assignmentId={assignmentId} resubmit={view.submissions.length > 0} />

      <p>
        <Link href="/mi-curso" className="text-sm underline">
          ← {t.backToCourse}
        </Link>
      </p>
    </main>
  );
}
