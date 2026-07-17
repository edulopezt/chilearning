import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getCompanyActionPanel } from "@/modules/portal-empresa/company-portal-service";
import type { CompanyPanelRow } from "@/modules/portal-empresa/domain/company";

export const dynamic = "force-dynamic";

const t = esCL.companyPortal;

function gradeLabel(row: CompanyPanelRow): string {
  return row.grade === null ? "—" : row.grade.toFixed(1);
}

/**
 * Folio + ESTADO. Nunca el folio a secas: un certificado revocado conserva su
 * folio (revocar es un UPDATE de `status`), así que pintar solo el folio le dice
 * a RRHH que su trabajador está certificado cuando el documento ya no vale.
 * Mismo badge que /admin/acciones/[id]/certificados.
 */
function CertCell({ row }: { row: CompanyPanelRow }) {
  if (!row.certificateFolio) {
    return <span className="text-muted-foreground">{t.noCertificate}</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="break-all">{row.certificateFolio}</span>
      {row.certificateStatus === "issued" && (
        <span className="rounded bg-green-100 px-2 py-0.5 font-sans text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
          {t.certIssued}
        </span>
      )}
      {row.certificateStatus === "revoked" && (
        <span className="rounded bg-red-100 px-2 py-0.5 font-sans text-xs font-medium text-red-800 dark:bg-red-900 dark:text-red-200">
          {t.certRevoked}
        </span>
      )}
    </span>
  );
}

/**
 * Panel de trabajadores de MI empresa en una acción (task 5.2, HU-8.1).
 * El servicio ya acotó las filas a la empresa del caller y auditó la consulta;
 * aquí solo se pinta. En <sm la tabla colapsa a tarjetas (RNF-6).
 */
export default async function CompanyActionPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const { id } = await params;
  // Portal GATED: sin membresía vigente, o si la acción no tiene trabajadores
  // MÍOS, devuelve null (no distingue "no existe" de "no es tuya", a propósito).
  const panel = await getCompanyActionPanel(principal, id);
  if (!panel) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.noAccess}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.panelTitle}</h1>
        <p className="text-sm">
          <span className="font-mono">{panel.codigoAccion}</span>
          {" · "}
          {panel.courseName}
          {" · "}
          <span className="text-muted-foreground">
            {panel.startsOn ?? "—"} → {panel.endsOn ?? "—"}
          </span>
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1" />
        <a
          href={`/api/empresa/reportes/${panel.actionId}`}
          className="min-h-11 rounded-md border px-4 py-2 text-sm font-medium underline-offset-2 hover:underline"
        >
          {t.download}
        </a>
      </div>
      <p className="text-muted-foreground text-xs">{t.runNote}</p>

      {panel.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.empty}</p>
      ) : (
        <>
          {/* ≥sm: tabla */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3">{t.colWorker}</th>
                  <th className="py-2 pr-3">{t.colRun}</th>
                  <th className="py-2 pr-3">{t.colProgress}</th>
                  <th className="py-2 pr-3">{t.colAttendance}</th>
                  <th className="py-2 pr-3">{t.colGrade}</th>
                  <th className="py-2">{t.colCertificate}</th>
                </tr>
              </thead>
              <tbody>
                {panel.rows.map((row) => (
                  <tr key={row.enrollmentId} className="border-b last:border-0">
                    <td className="py-2 pr-3">{row.nombre}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{row.runMasked}</td>
                    <td className="py-2 pr-3">{row.progressPct}%</td>
                    <td className="py-2 pr-3">{row.exento ? t.becario : row.attendanceDays}</td>
                    <td className="py-2 pr-3">{gradeLabel(row)}</td>
                    <td className="py-2 font-mono text-xs">
                      <CertCell row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* <sm: tarjetas */}
          <ul className="flex flex-col gap-2 sm:hidden">
            {panel.rows.map((row) => (
              <li key={row.enrollmentId} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
                <p className="font-medium break-words">{row.nombre}</p>
                <p className="text-muted-foreground font-mono text-xs">{row.runMasked}</p>
                <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground text-xs">{t.colProgress}</dt>
                  <dd className="text-xs">{row.progressPct}%</dd>
                  <dt className="text-muted-foreground text-xs">{t.colAttendance}</dt>
                  <dd className="text-xs">
                    {row.exento ? t.becario : `${row.attendanceDays} ${t.days}`}
                  </dd>
                  <dt className="text-muted-foreground text-xs">{t.colGrade}</dt>
                  <dd className="text-xs">{row.grade === null ? t.noGrade : gradeLabel(row)}</dd>
                  <dt className="text-muted-foreground text-xs">{t.colCertificate}</dt>
                  <dd className="font-mono text-xs">
                    <CertCell row={row} />
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}

      <p>
        <Link href="/empresa" className="text-sm underline">
          ← {t.back}
        </Link>
      </p>
    </main>
  );
}
