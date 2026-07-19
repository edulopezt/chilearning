import Link from "next/link";
import { BookOpenIcon } from "lucide-react";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { listCourses } from "@/modules/academico/course-service";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CourseForm } from "./course-form";
import { CloneButton } from "./clone-button";
import { ValidityForm } from "./validity-form";

export const dynamic = "force-dynamic";

const MODALITY_LABEL: Record<string, string> = {
  elearning: esCL.courses.modElearning,
  blended: esCL.courses.modBlended,
  presential: esCL.courses.modPresential,
};
const STATUS_LABEL: Record<string, string> = {
  draft: esCL.courses.statusDraft,
  published: esCL.courses.statusPublished,
};

/** Gestión de cursos (task 1.1, HU-3.1/4.4). Admin/coordinador. */
export default async function CoursesPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator"])) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{esCL.courses.forbidden}</p>
      </main>
    );
  }

  const courses = await listCourses(principal);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <PageHeader
        title={esCL.courses.title}
        description={
          <>
            {esCL.courses.intro}{" "}
            {/* El constructor libre de abajo SIGUE disponible; el asistente es una entrada alternativa (task 5.10). */}
            <Link href="/admin/cursos/asistente" className="underline underline-offset-4">
              {esCL.courses.assistedCreate} →
            </Link>
          </>
        }
      />

      <section className="flex flex-col gap-3">
        {courses.length === 0 ? (
          <EmptyState icon={<BookOpenIcon />} title={esCL.courses.empty} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{esCL.courses.colName}</TableHead>
                <TableHead>{esCL.courses.colModality}</TableHead>
                <TableHead>{esCL.courses.colHours}</TableHead>
                <TableHead>{esCL.courses.colStatus}</TableHead>
                <TableHead>{esCL.courses.colValidity}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {courses.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    {c.name}
                    {c.sence ? <span className="text-muted-foreground"> · SENCE</span> : null}
                  </TableCell>
                  <TableCell>{MODALITY_LABEL[c.modality] ?? c.modality}</TableCell>
                  <TableCell>{c.hours}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === "published" ? "success" : "secondary"}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <ValidityForm courseId={c.id} validityMonths={c.validity_months} />
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-3">
                      <Link href={`/admin/cursos/${c.id}/lecciones`} className="text-sm underline underline-offset-4">
                        {esCL.lessons.title}
                      </Link>
                      <Link href={`/admin/cursos/${c.id}/comunicacion`} className="text-sm underline underline-offset-4">
                        {esCL.communication.title}
                      </Link>
                      <CloneButton courseId={c.id} />
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t pt-6">
        <h2 className="text-lg font-semibold">{esCL.courses.newCourse}</h2>
        <CourseForm />
      </section>
    </main>
  );
}
