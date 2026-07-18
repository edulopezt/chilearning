import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { hasRole } from "@/modules/core/domain/rbac";
import {
  getFrequentTopics,
  getTenantUsageSummary,
  listCourseTutorConfigs,
} from "@/modules/tutor-ia/tutor-admin-service";
import { saveCourseTutorConfigAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.tutorIA;

/** Panel admin del Tutor IA (task 5.8b, HU-11.2): toggle por curso + límite
 *  diario, presupuesto/costo del tenant y temas frecuentes. Solo
 *  otec_admin/coordinator. */
export default async function TutorIaAdminPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  if (!principal.tenantId || !(hasRole(principal, "otec_admin") || hasRole(principal, "coordinator"))) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.admin.forbidden}</p>
      </main>
    );
  }

  const [courses, usage, topics] = await Promise.all([
    listCourseTutorConfigs(principal),
    getTenantUsageSummary(principal),
    getFrequentTopics(principal),
  ]);

  const tokensPct =
    usage && usage.monthlyBudget > 0 ? Math.min(100, Math.round((usage.tokensThisMonth / usage.monthlyBudget) * 100)) : 0;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.adminTitle}</h1>
        <p className="text-muted-foreground text-sm">{t.admin.intro}</p>
      </header>

      {/* Presupuesto mensual del tenant */}
      {usage ? (
        <section className="flex flex-col gap-2 rounded-lg border p-4">
          <h2 className="text-lg font-semibold">{t.admin.budgetHeading}</h2>
          <div className="flex flex-col gap-1 text-sm">
            <span>
              {t.admin.budgetTokens}: <strong>{usage.tokensThisMonth.toLocaleString("es-CL")}</strong> {t.admin.budgetOf}{" "}
              {usage.monthlyBudget.toLocaleString("es-CL")}
            </span>
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
              <div
                className={`h-full rounded-full transition-all ${tokensPct >= 100 ? "bg-red-600" : tokensPct >= 80 ? "bg-amber-500" : "bg-green-600"}`}
                style={{ width: `${tokensPct}%` }}
              />
            </div>
            <span>
              {t.admin.budgetCost}:{" "}
              <strong>
                {usage.costUsdThisMonth.toLocaleString("es-CL", { style: "currency", currency: "USD", minimumFractionDigits: 4 })}
              </strong>
            </span>
          </div>
        </section>
      ) : null}

      {/* Config por curso: móvil = tarjetas, ≥sm = tabla (RNF-6). */}
      <section className="flex flex-col gap-3">
        {courses.length === 0 ? (
          <p className="text-muted-foreground text-sm">—</p>
        ) : (
          <>
            <ul className="flex flex-col gap-3 sm:hidden">
              {courses.map((c) => (
                <li key={c.courseId} className="rounded-md border p-3">
                  <CourseConfigForm course={c} />
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-3">{t.admin.colCourse}</th>
                    <th className="py-2 pr-3">{t.admin.colEnabled}</th>
                    <th className="py-2 pr-3">{t.admin.colDailyLimit}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {courses.map((c) => (
                    <tr key={c.courseId} className="border-b">
                      <td className="py-2 pr-3" colSpan={4}>
                        <CourseConfigForm course={c} inline />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Temas frecuentes */}
      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">{t.admin.topicsHeading}</h2>
        {topics.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.admin.topicsEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {topics.map((topic) => (
              <li key={topic.lessonId} className="flex items-center justify-between gap-2 rounded-md border p-2">
                <span className="break-words">{topic.lessonTitle}</span>
                <span className="text-muted-foreground shrink-0">
                  {topic.citedCount} {t.admin.colCitedCount.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function CourseConfigForm({
  course,
  inline = false,
}: {
  course: { courseId: string; courseName: string; enabled: boolean; dailyMessageLimit: number | null };
  inline?: boolean;
}) {
  return (
    <form
      action={saveCourseTutorConfigAction}
      className={inline ? "flex flex-wrap items-center gap-3" : "flex flex-col gap-2"}
    >
      <input type="hidden" name="courseId" value={course.courseId} />
      <span className="min-w-0 flex-1 font-medium break-words">{course.courseName}</span>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={course.enabled} className="h-5 w-5" />
        {t.admin.colEnabled}
      </label>
      <label className="flex min-h-11 flex-col gap-0.5 text-xs sm:w-32">
        {t.admin.colDailyLimit}
        <input
          type="number"
          name="dailyMessageLimit"
          min={1}
          defaultValue={course.dailyMessageLimit ?? ""}
          placeholder={t.admin.dailyLimitHint}
          className="min-h-11 rounded-md border px-2 text-sm"
        />
      </label>
      <button type="submit" className="min-h-11 rounded-md border px-4 text-sm font-medium">
        {t.admin.save}
      </button>
    </form>
  );
}
