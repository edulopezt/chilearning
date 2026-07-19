import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { cn } from "@/lib/utils";
import { getPrincipal } from "@/modules/core/auth/session";
import { isSuperadmin } from "@/modules/core/domain/rbac";
import type { TenantStatsRow } from "@/modules/plataforma/domain/overview";
import { getPlatformOverview } from "@/modules/plataforma/platform-service";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TenantSupportDetail } from "./tenant-detail";

export const dynamic = "force-dynamic";

const t = esCL.superadmin.board;

const PLAN_LABEL: Record<string, string> = {
  standard: esCL.superadmin.planStandard,
  pro: esCL.superadmin.planPro,
  enterprise: esCL.superadmin.planEnterprise,
};

/**
 * Fecha corta es-CL; null => "Sin actividad". La zona horaria es EXPLÍCITA: este
 * es un Server Component, así que sin ella formatea con la TZ del contenedor
 * (UTC en Coolify) y toda actividad entre 00:00 y 04:00 UTC se pinta con la fecha
 * del día siguiente. Misma convención que `tablero/notas` y `reportes`.
 */
function formatDate(iso: string | null): string {
  if (!iso) return t.never;
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "short",
    timeZone: "America/Santiago",
  }).format(new Date(iso));
}

function StatusBadge({ status }: Readonly<{ status: TenantStatsRow["status"] }>) {
  const active = status === "active";
  return (
    <Badge variant={active ? "success" : "warning"}>
      {active ? esCL.superadmin.statusActive : esCL.superadmin.statusSuspended}
    </Badge>
  );
}

function SummaryCard({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <Card className="gap-1 p-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-2xl font-bold tabular-nums">{value}</span>
    </Card>
  );
}

/** Fila "Operar" — Link de navegación estilizado como botón outline. */
function ManageLink({ size }: Readonly<{ size: "default" | "sm" }>) {
  return (
    <Link href="/superadmin/tenants" className={cn(buttonVariants({ variant: "outline", size }))}>
      {t.manage}
    </Link>
  );
}

/**
 * Tablero superadmin (task 5.5, HU-10.3): tenants activos, uso, errores SENCE
 * agregados y salud del sistema. Bajo el layout de plataforma (gate por claim),
 * con gate propio: la página no confía en que el layout haya corrido.
 *
 * SOLO agregados (spec §3): ni un dato de alumno ni contenido pedagógico.
 */
export default async function SuperadminBoardPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (!isSuperadmin(principal)) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{esCL.superadmin.forbidden}</p>
      </main>
    );
  }

  const overview = await getPlatformOverview(principal);
  if (!overview) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{esCL.superadmin.forbidden}</p>
      </main>
    );
  }
  const { summary, tenants, health, metrics } = overview;
  const dbOk = health.checks.db === "ok";
  // Las métricas fallaron: `summary`/`tenants` van en cero/vacío porque no se
  // pudieron leer, NO porque la plataforma esté vacía. Pintarlos sería afirmar
  // que no hay OTECs suspendidas, ni alertas, ni errores SENCE — exactamente lo
  // que este tablero existe para detectar. Mejor no decir nada que mentir en cero.
  const metricsOk = metrics === "ok";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title={t.title}
        description={t.intro}
        actions={
          <Link
            href="/superadmin/tenants"
            className={cn(buttonVariants({ variant: "outline", size: "default" }))}
          >
            {t.manageTenants}
          </Link>
        }
      />

      {!metricsOk && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t.metricsUnavailable}</AlertDescription>
        </Alert>
      )}

      {metricsOk && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t.summaryHeading}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryCard label={t.totalTenants} value={summary.totalTenants} />
            <SummaryCard label={t.active} value={summary.active} />
            <SummaryCard label={t.suspended} value={summary.suspended} />
            <SummaryCard label={t.totalStudents} value={summary.totalStudents} />
            <SummaryCard label={t.totalEnrollments} value={summary.totalEnrollments} />
            <SummaryCard label={t.openAlerts} value={summary.openAlerts} />
          </div>
        </section>
      )}

      {/* La salud se pinta SIEMPRE, también con las métricas caídas: una BD abajo
          debe seguir siendo visible. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.healthHeading}</h2>
        <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
          <Badge variant={health.status === "ok" ? "success" : "destructive"}>
            {health.status === "ok" ? t.healthStatusOk : t.healthStatusDegraded}
          </Badge>
          <span className="text-muted-foreground">
            {t.healthDb}:{" "}
            <span className={dbOk ? "text-success" : "text-destructive"}>
              {health.checks.db === "ok" ? t.healthOk : health.checks.db === "fail" ? t.healthFail : t.healthSkip}
            </span>
          </span>
          <span className="text-muted-foreground">
            {t.healthVersion}: <code className="font-mono text-xs">{health.version}</code>
          </span>
        </div>
      </section>

      {metricsOk && (
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.tenantsHeading}</h2>
        {tenants.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.empty}</p>
        ) : (
          <>
            {/* Móvil (360 px): tarjetas. La tabla de abajo se oculta. */}
            <ul className="flex flex-col gap-2 md:hidden">
              {tenants.map((tenant) => (
                <li key={tenant.tenantId}>
                  <Card className="gap-3 p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium break-words">{tenant.name}</p>
                        <p className="text-muted-foreground text-xs">
                          <code className="font-mono break-all">{tenant.slug}</code>
                          {" · "}
                          {PLAN_LABEL[tenant.plan] ?? tenant.plan}
                        </p>
                      </div>
                      <StatusBadge status={tenant.status} />
                    </div>

                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{t.colStudents}</dt>
                        <dd className="font-medium tabular-nums">{tenant.students}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{t.colEnrollments}</dt>
                        <dd className="font-medium tabular-nums">{tenant.enrollments}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{t.colOpenAlerts}</dt>
                        <dd className={`font-medium tabular-nums ${tenant.openAlerts > 0 ? "text-warning" : ""}`}>
                          {tenant.openAlerts}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{t.colSenceErrors}</dt>
                        <dd className={`font-medium tabular-nums ${tenant.senceErrors7d > 0 ? "text-destructive" : ""}`}>
                          {tenant.senceErrors7d}
                        </dd>
                      </div>
                      <div className="col-span-2 flex justify-between gap-2">
                        <dt className="text-muted-foreground">{t.colLastActivity}</dt>
                        <dd className="font-medium">{formatDate(tenant.lastEnrollmentAt)}</dd>
                      </div>
                    </dl>

                    <div className="flex flex-col gap-2 border-t pt-2">
                      <ManageLink size="default" />
                      <TenantSupportDetail tenantId={tenant.tenantId} size="default" />
                    </div>
                  </Card>
                </li>
              ))}
            </ul>

            {/* Escritorio (1440 px): tabla. `overflow-x-auto` acota el scroll a
                la tabla — el body nunca scrollea en horizontal (RNF-6). */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.colTenant}</TableHead>
                    <TableHead>{t.colPlan}</TableHead>
                    <TableHead>{t.colStatus}</TableHead>
                    <TableHead className="text-right">{t.colStudents}</TableHead>
                    <TableHead className="text-right">{t.colEnrollments}</TableHead>
                    <TableHead className="text-right">{t.colOpenAlerts}</TableHead>
                    <TableHead className="text-right">{t.colSenceErrors}</TableHead>
                    <TableHead>{t.colLastActivity}</TableHead>
                    <TableHead>{t.manage}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map((tenant) => (
                    <TableRow key={tenant.tenantId} className="align-top">
                      <TableCell>
                        <span className="font-medium">{tenant.name}</span>
                        <br />
                        <code className="text-muted-foreground font-mono text-xs">{tenant.slug}</code>
                      </TableCell>
                      <TableCell>{PLAN_LABEL[tenant.plan] ?? tenant.plan}</TableCell>
                      <TableCell><StatusBadge status={tenant.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">{tenant.students}</TableCell>
                      <TableCell className="text-right tabular-nums">{tenant.enrollments}</TableCell>
                      <TableCell className={`text-right tabular-nums ${tenant.openAlerts > 0 ? "text-warning" : ""}`}>
                        {tenant.openAlerts}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${tenant.senceErrors7d > 0 ? "text-destructive" : ""}`}>
                        {tenant.senceErrors7d}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(tenant.lastEnrollmentAt)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-2">
                          <ManageLink size="sm" />
                          <TenantSupportDetail tenantId={tenant.tenantId} size="sm" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>
      )}
    </main>
  );
}
