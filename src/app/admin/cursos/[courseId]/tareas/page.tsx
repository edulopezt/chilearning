import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listAssignmentsByCourse } from "@/modules/evaluacion/assignment-service";
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
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      <section className="flex flex-col gap-2">
        {assignments.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {assignments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                <span className="flex-1 font-medium">{a.title}</span>
                <span className="text-muted-foreground text-sm">
                  {a.due_at ? new Date(a.due_at).toLocaleString("es-CL") : "—"}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    a.status === "published"
                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                      : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                  }`}
                >
                  {a.status === "published" ? t.statusPublished : t.statusDraft}
                </span>
                <form action={publishAssignmentAction}>
                  <input type="hidden" name="assignmentId" value={a.id} />
                  <input type="hidden" name="courseId" value={courseId} />
                  <input type="hidden" name="publish" value={a.status === "published" ? "false" : "true"} />
                  <button type="submit" className="text-sm underline">
                    {a.status === "published" ? t.unpublish : t.publish}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t pt-6">
        <h2 className="text-lg font-semibold">{t.newAssignment}</h2>
        <AssignmentForm courseId={courseId} />
      </section>

      <p className="flex gap-4">
        <Link href={`/admin/cursos/${courseId}/lecciones`} className="text-sm underline">
          ← {t.lessonsLink}
        </Link>
        <Link href={`/admin/cursos/${courseId}/evaluaciones`} className="text-sm underline">
          {t.quizzesLink} →
        </Link>
      </p>
    </main>
  );
}
