import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { tenantGuard } from "@/lib/tenant-guard";
import { listLessons } from "@/modules/academico/lesson-service";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { LessonRowActions } from "./lesson-row-actions";
import { NewLessonForm } from "./new-lesson-form";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  text: esCL.lessons.kindText,
  video: esCL.lessons.kindVideo,
  file: esCL.lessons.kindFile,
  embed: esCL.lessons.kindEmbed,
  scorm: esCL.lessons.kindScorm,
};

export default async function LessonsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator"])) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{esCL.lessons.forbidden}</p>
      </main>
    );
  }

  const guard = tenantGuard(principal.tenantId);
  const { data: course } = await guard.from("courses").select("name").eq("id", courseId).maybeSingle();
  const lessons = await listLessons(principal, courseId);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{esCL.lessons.title}</h1>
        <p className="text-muted-foreground text-sm">
          {(course?.name as string) ?? ""} · {esCL.lessons.intro}
        </p>
        <span className="mt-1 flex gap-4 text-sm">
          <Link href={`/admin/cursos/${courseId}/evaluaciones`} className="underline">
            {esCL.quizzes.title} →
          </Link>
          <Link href={`/admin/cursos/${courseId}/tareas`} className="underline">
            {esCL.assignments.title} →
          </Link>
          <Link href={`/admin/cursos/${courseId}/scorm`} className="underline">
            {esCL.scorm.title} →
          </Link>
        </span>
      </header>

      <section className="flex flex-col gap-3">
        {lessons.length === 0 ? (
          <p className="text-muted-foreground text-sm">{esCL.lessons.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-2">{esCL.lessons.colOrder}</th>
                  <th className="py-2 pr-3">{esCL.lessons.colTitle}</th>
                  <th className="py-2 pr-3">{esCL.lessons.colKind}</th>
                  <th className="py-2 pr-3">{esCL.lessons.colStatus}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {lessons.map((l, i) => (
                  <tr key={l.id} className="border-b last:border-0 align-middle">
                    <td className="py-2 pr-2 font-mono">{i + 1}</td>
                    <td className="py-2 pr-3">{l.title}</td>
                    <td className="py-2 pr-3">{KIND_LABEL[l.kind] ?? l.kind}</td>
                    <td className="py-2 pr-3">
                      <span className={l.status === "published" ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}>
                        {l.status === "published" ? esCL.lessons.statusPublished : esCL.lessons.statusDraft}
                      </span>
                    </td>
                    <td className="py-2">
                      <LessonRowActions
                        courseId={courseId}
                        lesson={l}
                        isFirst={i === 0}
                        isLast={i === lessons.length - 1}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t pt-6">
        <h2 className="text-lg font-semibold">{esCL.lessons.newLesson}</h2>
        <NewLessonForm courseId={courseId} />
      </section>
    </main>
  );
}
