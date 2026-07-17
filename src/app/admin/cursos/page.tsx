import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { listCourses } from "@/modules/academico/course-service";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
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
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{esCL.courses.title}</h1>
        <p className="text-muted-foreground text-sm">{esCL.courses.intro}</p>
      </header>

      <section className="flex flex-col gap-3">
        {courses.length === 0 ? (
          <p className="text-muted-foreground text-sm">{esCL.courses.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3">{esCL.courses.colName}</th>
                  <th className="py-2 pr-3">{esCL.courses.colModality}</th>
                  <th className="py-2 pr-3">{esCL.courses.colHours}</th>
                  <th className="py-2 pr-3">{esCL.courses.colStatus}</th>
                  <th className="py-2 pr-3">{esCL.courses.colValidity}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {courses.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      {c.name}
                      {c.sence ? <span className="text-muted-foreground"> · SENCE</span> : null}
                    </td>
                    <td className="py-2 pr-3">{MODALITY_LABEL[c.modality] ?? c.modality}</td>
                    <td className="py-2 pr-3">{c.hours}</td>
                    <td className="py-2 pr-3">{STATUS_LABEL[c.status] ?? c.status}</td>
                    <td className="py-2 pr-3">
                      <ValidityForm courseId={c.id} validityMonths={c.validity_months} />
                    </td>
                    <td className="py-2">
                      <span className="flex flex-wrap items-center gap-3">
                        <Link href={`/admin/cursos/${c.id}/lecciones`} className="text-sm underline">
                          {esCL.lessons.title}
                        </Link>
                        <Link href={`/admin/cursos/${c.id}/comunicacion`} className="text-sm underline">
                          {esCL.communication.title}
                        </Link>
                        <CloneButton courseId={c.id} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t pt-6">
        <h2 className="text-lg font-semibold">{esCL.courses.newCourse}</h2>
        <CourseForm />
      </section>
    </main>
  );
}
