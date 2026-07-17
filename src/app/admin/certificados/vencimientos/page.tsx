import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { formatExpiryDate, type ExpirationRow } from "@/modules/certificados/domain/expiry-report";
import { getExpiryConfig } from "@/modules/certificados/expiry-config-service";
import { listExpirations } from "@/modules/certificados/expiry-report-service";
import { getPrincipal } from "@/modules/core/auth/session";
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
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      {/* Filtros: form GET (funciona sin JS y deja la URL compartible). */}
      <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {t.filterCompany}
          <select name="companyId" defaultValue={companyParam ?? "all"} className="min-h-11 rounded-md border px-3 text-base">
            <option value="all">{t.filterAllCompanies}</option>
            <option value="none">{t.filterParticular}</option>
            {report.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.razonSocial}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm sm:w-44">
          {t.filterWindow}
          <select name="windowDays" defaultValue={windowParam} className="min-h-11 rounded-md border px-3 text-base">
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {WINDOW_LABEL[w]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="min-h-11 rounded-md border px-4 text-sm font-medium">
          {t.filterApply}
        </button>
        <a href={exportHref} className="flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium">
          {t.download}
        </a>
      </form>

      {report.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.empty}</p>
      ) : (
        <>
          {/* Móvil: tarjetas. ≥lg: tabla. Sin scroll horizontal (RNF-6). */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {report.rows.map((row) => (
              <li key={row.certificateId} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
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
              </li>
            ))}
          </ul>

          <div className="hidden lg:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3">{t.colWorker}</th>
                  <th className="py-2 pr-3">{t.colRun}</th>
                  <th className="py-2 pr-3">{t.colCourse}</th>
                  <th className="py-2 pr-3">{t.colFolio}</th>
                  <th className="py-2 pr-3">{t.colExpiresOn}</th>
                  <th className="py-2 pr-3">{t.colDaysLeft}</th>
                  <th className="py-2 pr-3">{t.colCompany}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.certificateId} className="border-b">
                    <td className="py-2 pr-3">{row.studentName}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{row.runMasked}</td>
                    <td className="py-2 pr-3">
                      {row.courseName}
                      <span className="text-muted-foreground block font-mono text-xs">{row.codigoAccion}</span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{row.folio}</td>
                    <td className="py-2 pr-3">{formatExpiryDate(row.expiresAt)}</td>
                    <td className="py-2 pr-3">
                      <DaysLeft daysLeft={row.daysLeft} />
                    </td>
                    <td className="py-2 pr-3">{row.razonSocial ?? t.particular}</td>
                    <td className="py-2">
                      <RecertifyLink row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
  if (daysLeft < 0) return <span className="font-medium text-red-600">{t.expired}</span>;
  return (
    <span className={daysLeft <= 30 ? "font-medium text-amber-600" : undefined}>
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
 */
function RecertifyLink({ row }: { row: ExpirationRow }): React.ReactElement {
  if (row.recertifyActionId) {
    return (
      <Link
        href={`/admin/inscripciones?actionId=${row.recertifyActionId}`}
        title={t.recertifyHint}
        className="inline-flex min-h-11 items-center rounded-md border px-3 text-xs font-medium"
      >
        {t.recertify}
      </Link>
    );
  }
  return (
    <Link
      href={`/admin/acciones?courseId=${row.courseId}`}
      title={t.recertifyNoActionHint}
      className="text-muted-foreground inline-flex min-h-11 items-center rounded-md border px-3 text-xs font-medium"
    >
      {t.recertifyNoAction}
    </Link>
  );
}
