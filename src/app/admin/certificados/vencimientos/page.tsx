import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { cn } from "@/lib/utils";
import { formatExpiryDate, type ExpirationRow } from "@/modules/certificados/domain/expiry-report";
import { getExpiryConfig } from "@/modules/certificados/expiry-config-service";
import { listExpirations } from "@/modules/certificados/expiry-report-service";
import { getPrincipal } from "@/modules/core/auth/session";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldLabel, FieldRoot } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExpiryConfigForm } from "./expiry-config-form";

export const dynamic = "force-dynamic";

const t = esCL.certExpiry;
const WINDOWS = ["30", "60", "90", "all"] as const;
const WINDOW_LABEL: Record<string, string> = {
  "30": t.window30,
  "60": t.window60,
  "90": t.window90,
  all: t.windowAll,
};

/**
 * Listado de vencimientos y config de alertas (task 5.12, HU-7.3).
 *
 * Los filtros van por SEARCHPARAMS con un `<form method="get">`: sin JS de por
 * medio, enlazable y compartible, y la página sigue siendo Server Component.
 * El gate y la auditoría viven en `expiry-report-service` (esta página no
 * consulta tablas directo).
 */
export default async function ExpirationsPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string; windowDays?: string }>;
}) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const sp = await searchParams;
  const companyParam = sp.companyId && sp.companyId !== "all" ? sp.companyId : null;
  const windowParam = sp.windowDays && WINDOWS.includes(sp.windowDays as (typeof WINDOWS)[number]) ? sp.windowDays : "all";
  const windowDays = windowParam === "all" ? null : Number(windowParam);

  const [report, config] = await Promise.all([
    listExpirations(principal, { companyId: companyParam, windowDays }),
    getExpiryConfig(principal),
  ]);
  // `listExpirations` devuelve null solo si el principal no está autorizado.
  if (!report || !config) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.forbidden}</p>
      </main>
    );
  }

  const query = new URLSearchParams();
  if (companyParam) query.set("companyId", companyParam);
  if (windowDays) query.set("windowDays", String(windowDays));
  const exportHref = `/api/reportes/vencimientos${query.size > 0 ? `?${query}` : ""}`;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader title={t.title} description={t.intro} />

      {/* Filtros: form GET (funciona sin JS y deja la URL compartible). */}
      <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <FieldRoot className="flex-1">
          <FieldLabel>{t.filterCompany}</FieldLabel>
          <Select name="companyId" defaultValue={companyParam ?? "all"}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.filterAllCompanies}</SelectItem>
              <SelectItem value="none">{t.filterParticular}</SelectItem>
              {report.companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.razonSocial}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRoot>
        <FieldRoot className="sm:w-44">
          <FieldLabel>{t.filterWindow}</FieldLabel>
          <Select name="windowDays" defaultValue={windowParam}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((w) => (
                <SelectItem key={w} value={w}>
                  {WINDOW_LABEL[w]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRoot>
        <Button type="submit" variant="outline">
          {t.filterApply}
        </Button>
        <a href={exportHref} className={cn(buttonVariants({ variant: "outline" }))}>
          {t.download}
        </a>
      </form>

      {report.rows.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        <>
          {/* Móvil: tarjetas. ≥sm: tabla. Sin scroll horizontal (RNF-6). */}
          <ul className="flex flex-col gap-3 sm:hidden">
            {report.rows.map((row) => (
              <li key={row.certificateId}>
                <Card className="gap-2 p-3 text-sm">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium break-words">{row.studentName}</span>
                    <span className="text-muted-foreground font-mono text-xs">{row.runMasked}</span>
                  </div>
                  <div className="text-muted-foreground flex flex-col gap-0.5 text-xs">
                    <span className="break-words">{row.courseName}</span>
                    <span>
                      <span className="font-mono">{row.codigoAccion}</span>
                      {" · "}
                      <span className="font-mono">{row.folio}</span>
                    </span>
                    <span>{row.razonSocial ?? t.particular}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm">
                      {formatExpiryDate(row.expiresAt)}
                      {" · "}
                      <DaysLeft daysLeft={row.daysLeft} />
                    </span>
                    <RecertifyLink row={row} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          <div className="hidden sm:block">
            <Table className="min-w-[44rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>{t.colWorker}</TableHead>
                  <TableHead>{t.colRun}</TableHead>
                  <TableHead>{t.colCourse}</TableHead>
                  <TableHead>{t.colFolio}</TableHead>
                  <TableHead>{t.colExpiresOn}</TableHead>
                  <TableHead>{t.colDaysLeft}</TableHead>
                  <TableHead>{t.colCompany}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((row) => (
                  <TableRow key={row.certificateId}>
                    <TableCell>{row.studentName}</TableCell>
                    <TableCell className="font-mono text-xs">{row.runMasked}</TableCell>
                    <TableCell>
                      {row.courseName}
                      <span className="text-muted-foreground block font-mono text-xs">{row.codigoAccion}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.folio}</TableCell>
                    <TableCell>{formatExpiryDate(row.expiresAt)}</TableCell>
                    <TableCell>
                      <DaysLeft daysLeft={row.daysLeft} />
                    </TableCell>
                    <TableCell>{row.razonSocial ?? t.particular}</TableCell>
                    <TableCell>
                      <RecertifyLink row={row} size="sm" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-muted-foreground text-xs">{t.runNote}</p>
        </>
      )}

      <ExpiryConfigForm offsetsDays={config.offsetsDays} enabled={config.enabled} isDefault={config.isDefault} />
    </main>
  );
}

/** Días restantes; lo ya vencido se marca, no se muestra como número negativo. */
function DaysLeft({ daysLeft }: { daysLeft: number }): React.ReactElement {
  if (daysLeft < 0) return <span className="text-destructive font-medium">{t.expired}</span>;
  return (
    <span className={daysLeft <= 30 ? "text-warning font-medium" : undefined}>
      {daysLeft} {t.days}
    </span>
  );
}

/**
 * Enlace de re-inscripción (CA: "enlace directo a re-inscripción en una nueva
 * acción").
 *
 * ⚠ ALCANCE HONESTO: hoy NO existe en el producto un alta de inscripción
 * individual — el único camino es el import CSV por acción (`enrollment-service`,
 * task 1.3), así que "precargar la inscripción" de UNA persona no es posible sin
 * inventar una feature que el spec no tiene. Lo que sí se hace, y es real:
 *  - si el curso ya tiene otra acción, el enlace lleva al import con ESA acción
 *    ya seleccionada (y su plantilla CSV correcta, con el grupo SENCE del curso);
 *  - si no la tiene, lleva a crear la acción nueva con el curso preseleccionado
 *    (el paso previo obligatorio de toda recertificación).
 *
 * `size`: "sm" en la fila de tabla de escritorio (contexto denso); "default"
 * (44px, RNF-6) en la tarjeta móvil, donde es el único camino táctil.
 */
function RecertifyLink({
  row,
  size = "default",
}: {
  row: ExpirationRow;
  size?: "default" | "sm";
}): React.ReactElement {
  if (row.recertifyActionId) {
    return (
      <Link
        href={`/admin/inscripciones?actionId=${row.recertifyActionId}`}
        title={t.recertifyHint}
        className={cn(buttonVariants({ variant: "outline", size }))}
      >
        {t.recertify}
      </Link>
    );
  }
  return (
    <Link
      href={`/admin/acciones?courseId=${row.courseId}`}
      title={t.recertifyNoActionHint}
      className={cn(buttonVariants({ variant: "outline", size }), "text-muted-foreground")}
    >
      {t.recertifyNoAction}
    </Link>
  );
}
