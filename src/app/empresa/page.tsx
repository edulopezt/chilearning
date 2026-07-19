import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { esCL } from "@/i18n/es-CL";
import { formatExpiryDate } from "@/modules/certificados/domain/expiry-report";
import { getPrincipal } from "@/modules/core/auth/session";
import {
  getMyCompany,
  listCompanyActions,
  listCompanyExpirations,
} from "@/modules/portal-empresa/company-portal-service";

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

  const [actions, expirations] = await Promise.all([
    listCompanyActions(principal),
    listCompanyExpirations(principal),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{company.razonSocial}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      {actions.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        <ul className="flex flex-col gap-3">
          {actions.map((a) => (
            <li key={a.actionId}>
              <Link href={`/empresa/acciones/${a.actionId}`} className="block">
                <Card className="gap-1 p-3 transition-colors hover:bg-accent/50">
                  <span className="font-medium">{a.courseName}</span>
                  <span className="text-muted-foreground text-sm">
                    <span className="font-mono">{a.codigoAccion}</span>
                    {" · "}
                    {a.workers} {t.workers}
                    {" · "}
                    {a.startsOn ?? "—"} → {a.endsOn ?? "—"}
                  </span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Certificados por vencer de MIS trabajadores (task 5.12, HU-7.3). La CA
          pide alertar "a la OTEC y a la empresa"; esta es la mitad de la empresa.
          El servicio ya acota a mi empresa, enmascara el RUN y audita. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.expiryTitle}</h2>
        <p className="text-muted-foreground text-sm">{t.expiryIntro}</p>
        {expirations.length === 0 ? (
          <EmptyState title={t.expiryEmpty} />
        ) : (
          <ul className="flex flex-col gap-2">
            {expirations.map((row) => (
              <li key={row.certificateId}>
                <Card className="gap-1 p-3 text-sm">
                  {/* Móvil: apilado; ≥sm: una fila. Sin scroll horizontal (RNF-6). */}
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium break-words">{row.studentName}</span>
                      <span className="text-muted-foreground text-xs">
                        <span className="font-mono">{row.runMasked}</span>
                        {" · "}
                        {row.courseName}
                      </span>
                    </div>
                    <span className="text-sm sm:text-right">
                      {t.expiryColExpiresOn} {formatExpiryDate(row.expiresAt)}
                      <span className="block text-xs">
                        <DaysLeft daysLeft={row.daysLeft} />
                      </span>
                    </span>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground text-xs">{t.runNote}</p>
      </section>
    </main>
  );
}

/** Días restantes; lo ya vencido se marca, no se muestra como número negativo. */
function DaysLeft({ daysLeft }: { daysLeft: number }) {
  if (daysLeft < 0) return <span className="font-medium text-destructive">{t.expiryExpired}</span>;
  return (
    <span className={daysLeft <= 30 ? "font-medium text-warning" : "text-muted-foreground"}>
      {daysLeft} {t.days}
    </span>
  );
}
