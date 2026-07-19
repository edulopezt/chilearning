import Link from "next/link";
import { LayersIcon } from "lucide-react";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { tenantGuard } from "@/lib/tenant-guard";
import { listLessons } from "@/modules/academico/lesson-service";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

export default async function LessonsPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ wizard?: string }>;
}) {
  const { courseId } = await params;
  const { wizard } = await searchParams;
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
      <PageHeader
        title={esCL.lessons.title}
        description={
          <>
            {(course?.name as string) ?? ""} · {esCL.lessons.intro}
            <span className="mt-1 flex flex-wrap gap-4">
              <Link href={`/admin/cursos/${courseId}/evaluaciones`} className="underline underline-offset-4">
                {esCL.quizzes.title} →
              </Link>
              <Link href={`/admin/cursos/${courseId}/tareas`} className="underline underline-offset-4">
                {esCL.assignments.title} →
              </Link>
              <Link href={`/admin/cursos/${courseId}/scorm`} className="underline underline-offset-4">
                {esCL.scorm.title} →
              </Link>
            </span>
          </>
        }
      />

      {/* Cierre del asistente guiado (task 5.10): el curso llega aquí recién generado, en borrador. */}
      {wizard === "ok" ? (
        <Alert variant="success" role="status">
          <AlertDescription>{esCL.wizard.generatedOk}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-3">
        {lessons.length === 0 ? (
          <EmptyState icon={<LayersIcon />} title={esCL.lessons.empty} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{esCL.lessons.colOrder}</TableHead>
                <TableHead>{esCL.lessons.colTitle}</TableHead>
                <TableHead>{esCL.lessons.colKind}</TableHead>
                <TableHead>{esCL.lessons.colStatus}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lessons.map((l, i) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono">{i + 1}</TableCell>
                  <TableCell>{l.title}</TableCell>
                  <TableCell>{KIND_LABEL[l.kind] ?? l.kind}</TableCell>
                  <TableCell>
                    <Badge variant={l.status === "published" ? "success" : "secondary"}>
                      {l.status === "published" ? esCL.lessons.statusPublished : esCL.lessons.statusDraft}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <LessonRowActions
                      courseId={courseId}
                      lesson={l}
                      isFirst={i === 0}
                      isLast={i === lessons.length - 1}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t pt-6">
        <h2 className="text-lg font-semibold">{esCL.lessons.newLesson}</h2>
        <NewLessonForm courseId={courseId} />
      </section>
    </main>
  );
}
