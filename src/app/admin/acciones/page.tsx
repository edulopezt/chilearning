import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { esCL } from "@/i18n/es-CL";
import { tenantGuard } from "@/lib/tenant-guard";
import { listActions } from "@/modules/academico/action-service";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { ActionForm } from "./action-form";
import { ActionControls } from "./action-controls";

export const dynamic = "force-dynamic";

/**
 * Gestión de acciones SENCE (task 1.2). Admin/coordinador.
 *
 * `?courseId=` preselecciona el curso en el alta: es el aterrizaje del enlace
 * "crear acción" del listado de vencimientos, cuando el curso todavía no tiene
 * una acción nueva donde recertificar (task 5.12, HU-7.3).
 */
export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string }>;
}) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  const { courseId: preselectedCourseId } = await searchParams;

  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator"])) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{esCL.actions.forbidden}</p>
      </main>
    );
  }

  const guard = tenantGuard(principal.tenantId);
  const [{ data: courseData }, actions] = await Promise.all([
    guard.from("courses").select("id, name"),
    listActions(principal),
  ]);
  const courses = ((courseData ?? []) as { id: string; name: string }[]).map((c) => ({
    id: c.id,
    name: c.name,
  }));
  const courseName = new Map(courses.map((c) => [c.id, c.name]));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <PageHeader title={esCL.actions.title} description={esCL.actions.intro} />

      <section className="flex flex-col gap-3">
        {actions.length === 0 ? (
          <EmptyState title={esCL.actions.empty} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{esCL.actions.colCourse}</TableHead>
                <TableHead>{esCL.actions.colCode}</TableHead>
                <TableHead>{esCL.actions.colLine}</TableHead>
                <TableHead>{esCL.actions.colEnv}</TableHead>
                <TableHead>{esCL.actions.colDates}</TableHead>
                <TableHead>{esCL.actions.colStatus}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {actions.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{courseName.get(a.course_id) ?? "—"}</TableCell>
                  <TableCell className="font-mono">{a.codigo_accion}</TableCell>
                  <TableCell>{a.training_line}</TableCell>
                  <TableCell>{a.environment === "rce" ? esCL.actions.envProd : esCL.actions.envTest}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.starts_on ?? "—"} → {a.ends_on ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={a.status === "active" ? "success" : "secondary"}>
                      {a.status === "active" ? esCL.actions.statusActive : esCL.actions.statusDraft}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-3">
                      <ActionControls actionId={a.id} status={a.status} />
                      <Link href={`/admin/acciones/${a.id}/preflight`} className="text-sm underline">
                        {esCL.preflight.linkLabel}
                      </Link>
                      <Link href={`/admin/acciones/${a.id}/cumplimiento`} className="text-sm underline">
                        {esCL.cumplimiento.linkLabel}
                      </Link>
                      <Link href={`/admin/acciones/${a.id}/encuesta`} className="text-sm underline">
                        {esCL.surveys.resultsLink}
                      </Link>
                      <Link href={`/admin/acciones/${a.id}/certificados`} className="text-sm underline">
                        {esCL.certificates.title}
                      </Link>
                      <Link href={`/admin/acciones/${a.id}/expediente`} className="text-sm underline">
                        {esCL.expediente.title}
                      </Link>
                      <Link href={`/admin/acciones/${a.id}/sesiones`} className="text-sm underline">
                        {esCL.liveSessions.title}
                      </Link>
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t pt-6">
        <h2 className="text-lg font-semibold">{esCL.actions.newAction}</h2>
        {courses.length === 0 ? (
          <EmptyState title={esCL.actions.noCourses} />
        ) : (
          <ActionForm courses={courses} initialCourseId={preselectedCourseId} />
        )}
      </section>
    </main>
  );
}
