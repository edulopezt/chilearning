import Link from "next/link";
import { FileTextIcon } from "lucide-react";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listAssignmentsByCourse } from "@/modules/evaluacion/assignment-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { AssignmentForm } from "./assignment-form";
import { publishAssignmentAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.assignments;

/** Gestión de tareas del curso (task 2.2, HU-6.2). */
export default async function TareasPage({
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
  const assignments = await listAssignmentsByCourse(principal, courseId);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <PageHeader title={t.title} description={t.intro} />

      <section className="flex flex-col gap-2">
        {assignments.length === 0 ? (
          <EmptyState icon={<FileTextIcon />} title={t.empty} />
        ) : (
          <ul className="flex flex-col gap-2">
            {assignments.map((a) => (
              <li key={a.id}>
                <Card className="flex-row flex-wrap items-center gap-3 p-3">
                  <span className="flex-1 font-medium">{a.title}</span>
                  <span className="text-sm text-muted-foreground">
                    {a.due_at ? new Date(a.due_at).toLocaleString("es-CL") : "—"}
                  </span>
                  <Badge variant={a.status === "published" ? "success" : "secondary"}>
                    {a.status === "published" ? t.statusPublished : t.statusDraft}
                  </Badge>
                  <form action={publishAssignmentAction}>
                    <input type="hidden" name="assignmentId" value={a.id} />
                    <input type="hidden" name="courseId" value={courseId} />
                    <input type="hidden" name="publish" value={a.status === "published" ? "false" : "true"} />
                    <Button type="submit" variant="ghost" size="sm">
                      {a.status === "published" ? t.unpublish : t.publish}
                    </Button>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t pt-6">
        <h2 className="text-lg font-semibold">{t.newAssignment}</h2>
        <AssignmentForm courseId={courseId} />
      </section>

      <p className="flex flex-wrap gap-4">
        <Link href={`/admin/cursos/${courseId}/lecciones`} className="text-sm underline underline-offset-4">
          ← {t.lessonsLink}
        </Link>
        <Link href={`/admin/cursos/${courseId}/evaluaciones`} className="text-sm underline underline-offset-4">
          {t.quizzesLink} →
        </Link>
        <Link href={`/admin/cursos/${courseId}/encuesta`} className="text-sm underline underline-offset-4">
          {esCL.surveys.title} →
        </Link>
      </p>
    </main>
  );
}
