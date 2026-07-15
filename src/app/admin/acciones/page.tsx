import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { tenantGuard } from "@/lib/tenant-guard";
import { listActions } from "@/modules/academico/action-service";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { ActionForm } from "./action-form";
import { ActionControls } from "./action-controls";

export const dynamic = "force-dynamic";

/** Gestión de acciones SENCE (task 1.2). Admin/coordinador. */
export default async function ActionsPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

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
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{esCL.actions.title}</h1>
        <p className="text-muted-foreground text-sm">{esCL.actions.intro}</p>
      </header>

      <section className="flex flex-col gap-3">
        {actions.length === 0 ? (
          <p className="text-muted-foreground text-sm">{esCL.actions.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3">{esCL.actions.colCourse}</th>
                  <th className="py-2 pr-3">{esCL.actions.colCode}</th>
                  <th className="py-2 pr-3">{esCL.actions.colLine}</th>
                  <th className="py-2 pr-3">{esCL.actions.colEnv}</th>
                  <th className="py-2 pr-3">{esCL.actions.colDates}</th>
                  <th className="py-2 pr-3">{esCL.actions.colStatus}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {actions.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{courseName.get(a.course_id) ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono">{a.codigo_accion}</td>
                    <td className="py-2 pr-3">{a.training_line}</td>
                    <td className="py-2 pr-3">
                      {a.environment === "rce" ? esCL.actions.envProd : esCL.actions.envTest}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {a.starts_on ?? "—"} → {a.ends_on ?? "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          a.status === "active"
                            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                            : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                        }`}
                      >
                        {a.status === "active" ? esCL.actions.statusActive : esCL.actions.statusDraft}
                      </span>
                    </td>
                    <td className="py-2">
                      <span className="flex flex-wrap items-center gap-3">
                        <ActionControls actionId={a.id} status={a.status} />
                        <Link href={`/admin/acciones/${a.id}/preflight`} className="underline">
                          {esCL.preflight.linkLabel}
                        </Link>
                        <Link href={`/admin/acciones/${a.id}/cumplimiento`} className="underline">
                          {esCL.cumplimiento.linkLabel}
                        </Link>
                        <Link href={`/admin/acciones/${a.id}/encuesta`} className="underline">
                          {esCL.surveys.resultsLink}
                        </Link>
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
        <h2 className="text-lg font-semibold">{esCL.actions.newAction}</h2>
        {courses.length === 0 ? (
          <p className="text-muted-foreground text-sm">{esCL.actions.noCourses}</p>
        ) : (
          <ActionForm courses={courses} />
        )}
      </section>
    </main>
  );
}
