import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { cn } from "@/lib/utils";
import { getPrincipal } from "@/modules/core/auth/session";
import { hasRole } from "@/modules/core/domain/rbac";
import {
  getFrequentTopics,
  getTenantUsageSummary,
  listCourseTutorConfigs,
} from "@/modules/tutor-ia/tutor-admin-service";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldControl, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
      <PageHeader title={t.adminTitle} description={t.admin.intro} />

      {/* Presupuesto mensual del tenant */}
      {usage ? (
        <Card className="gap-2 p-4">
          <h2 className="text-lg font-semibold">{t.admin.budgetHeading}</h2>
          <div className="flex flex-col gap-1 text-sm">
            <span>
              {t.admin.budgetTokens}: <strong>{usage.tokensThisMonth.toLocaleString("es-CL")}</strong> {t.admin.budgetOf}{" "}
              {usage.monthlyBudget.toLocaleString("es-CL")}
            </span>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  tokensPct >= 100 ? "bg-destructive" : tokensPct >= 80 ? "bg-warning" : "bg-success",
                )}
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
        </Card>
      ) : null}

      {/* Config por curso: móvil = tarjetas, ≥sm = tabla (RNF-6). */}
      <section className="flex flex-col gap-3">
        {courses.length === 0 ? (
          <p className="text-muted-foreground text-sm">—</p>
        ) : (
          <>
            <ul className="flex flex-col gap-3 sm:hidden">
              {courses.map((c) => (
                <li key={c.courseId}>
                  <Card className="p-3">
                    <CourseConfigForm course={c} />
                  </Card>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.admin.colCourse}</TableHead>
                    <TableHead>{t.admin.colEnabled}</TableHead>
                    <TableHead>{t.admin.colDailyLimit}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {courses.map((c) => (
                    <TableRow key={c.courseId}>
                      <TableCell colSpan={4}>
                        <CourseConfigForm course={c} inline />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>

      {/* Temas frecuentes */}
      <Card className="gap-3 p-4">
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
      </Card>
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
      className={inline ? "flex flex-wrap items-center gap-3" : "flex flex-col gap-3"}
    >
      <input type="hidden" name="courseId" value={course.courseId} />
      <span className="min-w-0 flex-1 font-medium break-words">{course.courseName}</span>
      <Label>
        <Checkbox name="enabled" defaultChecked={course.enabled} />
        {t.admin.colEnabled}
      </Label>
      <FieldRoot className="sm:w-40">
        <FieldLabel>{t.admin.colDailyLimit}</FieldLabel>
        <FieldControl
          type="number"
          name="dailyMessageLimit"
          min={1}
          defaultValue={course.dailyMessageLimit ?? ""}
          placeholder={t.admin.dailyLimitHint}
        />
      </FieldRoot>
      <Button type="submit" variant="outline">
        {t.admin.save}
      </Button>
    </form>
  );
}
