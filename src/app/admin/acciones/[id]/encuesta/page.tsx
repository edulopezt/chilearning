import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { getSurveyResults } from "@/modules/evaluacion/survey-service";

export const dynamic = "force-dynamic";

const t = esCL.surveyResults;

/** Resultados agregados de la encuesta por acción (task 3.1, HU-6.3). */
export default async function EncuestaResultadosPage({
  params,
}: {
  params: Promise<{ id: string }>;
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

  const { id: actionId } = await params;
  const view = await getSurveyResults(principal, actionId);
  if (!view) redirect("/admin/acciones");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">
          {view.courseName} · {view.code}
        </p>
      </header>

      {view.surveys.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.noSurveys}</p>
      ) : (
        <div className="flex flex-col gap-8">
          {view.surveys.map((s) => (
            <section key={s.surveyId} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{s.title}</h2>
                <span className="text-muted-foreground text-sm">
                  {t.responses}: {s.aggregate.total}
                </span>
              </div>
              {s.aggregate.total === 0 ? (
                <p className="text-muted-foreground text-sm">{t.noResponses}</p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {s.aggregate.questions.map((q) => (
                    <li key={q.questionId} className="flex flex-col gap-2 rounded-lg border p-4">
                      <p className="font-medium">{q.label}</p>
                      {q.type === "scale" ? (
                        <div className="flex flex-col gap-1 text-sm">
                          <p className="text-muted-foreground">
                            {t.average}: <strong>{q.average === null ? "—" : q.average.toFixed(2)}</strong> (n={q.n})
                          </p>
                          {[...q.distribution.entries()].map(([value, count]) => {
                            const pct = q.n > 0 ? Math.round((count / q.n) * 100) : 0;
                            return (
                              <div key={value} className="flex items-center gap-2">
                                <span className="w-6 text-right tabular-nums">{value}</span>
                                <div className="h-3 flex-1 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-700">
                                  <div className="h-full rounded bg-blue-600" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="w-16 text-right tabular-nums text-muted-foreground">
                                  {count} · {pct}%
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : q.type === "single" ? (
                        <ul className="flex flex-col gap-1 text-sm">
                          {q.counts.map((c) => {
                            const pct = q.n > 0 ? Math.round((c.count / q.n) * 100) : 0;
                            return (
                              <li key={c.optionId} className="flex items-center gap-2">
                                <span className="flex-1">{c.text}</span>
                                <div className="h-3 w-32 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-700">
                                  <div className="h-full rounded bg-blue-600" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="w-16 text-right tabular-nums text-muted-foreground">
                                  {c.count} · {pct}%
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <div className="flex flex-col gap-1 text-sm">
                          <p className="text-muted-foreground text-xs">{t.textAnswers} ({q.n})</p>
                          <ul className="flex flex-col gap-1">
                            {q.texts.map((text, i) => (
                              <li key={i} className="rounded bg-neutral-50 p-2 dark:bg-neutral-900">
                                {text}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3 border-t pt-4">
        <a
          href={`/api/reportes/encuesta/${actionId}?formato=xlsx`}
          className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          {t.exportXlsx}
        </a>
        <a
          href={`/api/reportes/encuesta/${actionId}?formato=csv`}
          className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          {t.exportCsv}
        </a>
        <Link href="/admin/acciones" className="inline-flex min-h-11 items-center text-sm underline">
          {t.backToAction}
        </Link>
      </div>
    </main>
  );
}
