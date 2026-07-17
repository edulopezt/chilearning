import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getMyCompany, listCompanyActions } from "@/modules/portal-empresa/company-portal-service";

export const dynamic = "force-dynamic";

const t = esCL.companyPortal;

/**
 * Home del portal de la empresa cliente (task 5.2, HU-8.1): razón social +
 * acciones contratadas. SOLO LECTURA: esta ruta no monta formularios ni Server
 * Actions. El gate (rol `company` + membresía vigente) y la auditoría viven en
 * `company-portal-service` — la página nunca consulta tablas directo.
 */
export default async function CompanyPortalPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const company = await getMyCompany(principal);
  if (!company) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.noAccess}</p>
      </main>
    );
  }

  const actions = await listCompanyActions(principal);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{company.razonSocial}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      {actions.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {actions.map((a) => (
            <li key={a.actionId}>
              <Link
                href={`/empresa/acciones/${a.actionId}`}
                className="flex min-h-11 flex-col gap-1 rounded-md border p-3 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                <span className="font-medium">{a.courseName}</span>
                <span className="text-muted-foreground text-sm">
                  <span className="font-mono">{a.codigoAccion}</span>
                  {" · "}
                  {a.workers} {t.workers}
                  {" · "}
                  {a.startsOn ?? "—"} → {a.endsOn ?? "—"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
