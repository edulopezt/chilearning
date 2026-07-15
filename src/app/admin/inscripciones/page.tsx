import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { tenantGuard } from "@/lib/tenant-guard";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";

interface ActionOption {
  id: string;
  label: string;
}

/** Import de alumnos por CSV (task 1.3, HU-2.2/3.2/3.3). Admin/coordinador. */
export default async function ImportEnrollmentsPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator"])) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{esCL.enrollmentImport.forbidden}</p>
      </main>
    );
  }

  const guard = tenantGuard(principal.tenantId);
  const { data } = await guard
    .from("actions")
    .select("id, codigo_accion, course:courses(name)");

  const actions: ActionOption[] = (data ?? []).map((a) => {
    const course = a.course as { name?: string } | { name?: string }[] | null;
    const courseName = Array.isArray(course) ? course[0]?.name : course?.name;
    return {
      id: a.id as string,
      label: courseName ? `${courseName} · ${a.codigo_accion}` : String(a.codigo_accion),
    };
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{esCL.enrollmentImport.title}</h1>
        <p className="text-muted-foreground text-sm">{esCL.enrollmentImport.intro}</p>
      </header>
      {actions.length === 0 ? (
        <p className="text-muted-foreground">{esCL.enrollmentImport.noActions}</p>
      ) : (
        <ImportForm actions={actions} />
      )}
    </main>
  );
}
