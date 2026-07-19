import Link from "next/link";
import { ClipboardCheckIcon } from "lucide-react";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listSurveysByCourse } from "@/modules/evaluacion/survey-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader title={t.title} description={t.intro} />

      <section className="flex flex-col gap-2">
        {surveys.length === 0 ? (
          <EmptyState icon={<ClipboardCheckIcon />} title={t.empty} />
        ) : (
          <ul className="flex flex-col gap-2">
            {surveys.map((s) => (
              <li key={s.id}>
                <Card className="flex-row flex-wrap items-center gap-3 p-3">
                  <span className="flex-1 font-medium">{s.title}</span>
                  <Badge variant="outline">{s.anonymous ? t.anonymousBadge : t.nominalBadge}</Badge>
                  <Badge variant={s.status === "published" ? "success" : "secondary"}>
                    {s.status === "published" ? t.statusPublished : t.statusDraft}
                  </Badge>
                  <form action={publishSurveyAction}>
                    <input type="hidden" name="surveyId" value={s.id} />
                    <input type="hidden" name="courseId" value={courseId} />
                    <input type="hidden" name="publish" value={s.status === "published" ? "false" : "true"} />
                    <Button type="submit" variant="ghost" size="sm">
                      {s.status === "published" ? t.unpublish : t.publish}
                    </Button>
                  </form>
                </Card>
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
        <Link href={`/admin/cursos/${courseId}/tareas`} className="text-sm underline underline-offset-4">
          ← {t.lessonsLink}
        </Link>
      </p>
    </main>
  );
}
