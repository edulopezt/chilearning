import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { tenantGuard } from "@/lib/tenant-guard";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { maskRun } from "@/modules/certificados/domain/folio";
import { listCompanies } from "@/modules/portal-empresa/company-service";
import { ImportForm } from "./import-form";
import { assignEnrollmentCompanyAction } from "./actions";

export const dynamic = "force-dynamic";

/** Tope de la lista de vinculación: es una vista de trabajo, no un reporte. */
const ENROLLMENT_LIMIT = 200;

interface ActionOption {
  id: string;
  label: string;
  /** Código SENCE del curso (para generar la plantilla con el grupo real, HU-2.2). */
  codSence: string | null;
}

interface EnrollmentRow {
  id: string;
  name: string;
  runMasked: string;
  actionLabel: string;
  companyId: string | null;
}

/**
 * Import de alumnos por CSV (task 1.3, HU-2.2/3.2/3.3). Admin/coordinador.
 *
 * `?actionId=` preselecciona la acción destino: es el aterrizaje del enlace de
 * re-inscripción del listado de vencimientos (task 5.12, HU-7.3).
 */
export default async function ImportEnrollmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ actionId?: string }>;
}) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  const { actionId: preselectedActionId } = await searchParams;

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
    .select("id, codigo_accion, course:courses(name, cod_sence)");

  const actions: ActionOption[] = (data ?? []).map((a) => {
    const rel = a.course as
      | { name?: string; cod_sence?: string | null }
      | { name?: string; cod_sence?: string | null }[]
      | null;
    const course = Array.isArray(rel) ? rel[0] : rel;
    return {
      id: a.id as string,
      label: course?.name ? `${course.name} · ${a.codigo_accion}` : String(a.codigo_accion),
      codSence: course?.cod_sence ?? null,
    };
  });

  // Vinculación inscripción↔empresa (task 5.2, HU-8.1): es lo que decide qué ve
  // cada empresa en su portal, así que vive junto al alta de inscripciones.
  const actionLabel = new Map(actions.map((a) => [a.id, a.label]));
  const [companies, { data: enrollmentData }] = await Promise.all([
    listCompanies(principal),
    guard.db
      .from("enrollments")
      .select("id, first_names, last_names, run, action_id, company_id, created_at")
      .eq("tenant_id", principal.tenantId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(ENROLLMENT_LIMIT),
  ]);

  const enrollments: EnrollmentRow[] = (enrollmentData ?? []).map((e) => {
    const first = ((e.first_names as string | null) ?? "").trim();
    const last = ((e.last_names as string | null) ?? "").trim();
    return {
      id: e.id as string,
      name: last ? (first ? `${last}, ${first}` : last) : first || "—",
      // Enmascarado por minimización: para vincular basta el nombre; el RUN solo
      // desambigua homónimos (Ley 21.719).
      runMasked: maskRun((e.run as string) ?? ""),
      actionLabel: actionLabel.get(e.action_id as string) ?? String(e.action_id),
      companyId: (e.company_id as string | null) ?? null,
    };
  });

  const tc = esCL.enrollmentCompany;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{esCL.enrollmentImport.title}</h1>
        <p className="text-muted-foreground text-sm">{esCL.enrollmentImport.intro}</p>
      </header>
      {actions.length === 0 ? (
        <p className="text-muted-foreground">{esCL.enrollmentImport.noActions}</p>
      ) : (
        <ImportForm actions={actions} initialActionId={preselectedActionId} />
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{tc.heading}</h2>
        <p className="text-muted-foreground text-sm">{tc.intro}</p>
        {(companies ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">{tc.noCompanies}</p>
        ) : enrollments.length === 0 ? (
          <p className="text-muted-foreground text-sm">{tc.empty}</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {enrollments.map((e) => (
                <li key={e.id} className="rounded-md border p-3 text-sm">
                  {/* Móvil: apilado; ≥sm: una fila. Sin scroll horizontal (RNF-6). */}
                  <form action={assignEnrollmentCompanyAction} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input type="hidden" name="enrollmentId" value={e.id} />
                    <div className="flex-1">
                      <p className="font-medium break-words">{e.name}</p>
                      <p className="text-muted-foreground text-xs">
                        <span className="font-mono">{e.runMasked}</span>
                        {" · "}
                        {e.actionLabel}
                      </p>
                    </div>
                    <label className="flex flex-col gap-1 sm:w-56">
                      <span className="sr-only">{tc.colCompany}</span>
                      <select
                        name="companyId"
                        defaultValue={e.companyId ?? ""}
                        className="min-h-11 rounded-md border px-3"
                      >
                        <option value="">{tc.particular}</option>
                        {(companies ?? []).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.razonSocial}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" className="min-h-11 rounded-md border px-4 text-sm font-medium">
                      {tc.save}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            {enrollments.length === ENROLLMENT_LIMIT ? (
              <p className="text-muted-foreground text-xs">{tc.truncated}</p>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
