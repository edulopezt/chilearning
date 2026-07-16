import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { BECARIO_LABEL } from "@/modules/academico/domain/enrollment-group";
import { getActionEligibility, type EligibilityRow } from "@/modules/certificados/certificates-service";
import type { EligibilityReason } from "@/modules/certificados/domain/eligibility";
import { RevokeForm } from "./revoke-form";
import { issueBatchAction, issueCertificateAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.certificates;

const REASON_LABEL: Record<EligibilityReason, string> = {
  lessons_incomplete: t.reasonLessons,
  grade_below_min: t.reasonGrade,
  survey_pending: t.reasonSurvey,
  attendance_below_min: t.reasonAttendance,
};

/** Emisión y revocación de certificados por acción (task 3.2, HU-7.1/7.2). */
export default async function CertificadosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator"])) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.forbidden}</p>
      </main>
    );
  }

  const { id: actionId } = await params;
  const view = await getActionEligibility(principal, actionId);
  if (!view) redirect("/admin/acciones");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">
          {view.courseName} · {view.code}
        </p>
        {view.isSence ? (
          <p className="text-muted-foreground text-sm">
            {t.thresholdNote}: <strong>{view.minAttendancePct}%</strong>
          </p>
        ) : null}
      </header>

      {view.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.empty}</p>
      ) : (
        <>
          <form action={issueBatchAction}>
            <input type="hidden" name="actionId" value={actionId} />
            <button type="submit" className="min-h-11 rounded-md bg-neutral-900 px-4 text-sm font-medium text-white dark:bg-white dark:text-neutral-900">
              {t.issueAll}
            </button>
          </form>

          {/* Tabla ≥sm, tarjetas <sm (RNF-6) */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3">{t.colStudent}</th>
                  <th className="py-2 pr-3">{t.colGroup}</th>
                  <th className="py-2 pr-3">{t.colAttendance}</th>
                  <th className="py-2 pr-3">{t.colGrade}</th>
                  <th className="py-2 pr-3">{t.colStatus}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r) => (
                  <tr key={r.enrollmentId} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3">
                      {r.name}
                      <span className="block text-xs text-muted-foreground">{r.run}</span>
                    </td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      {r.exento ? BECARIO_LABEL : (view.senceGroupLabel ?? "—")}
                    </td>
                    <td className="py-2 pr-3">{r.exento ? t.exento : `${r.attendancePct}%`}</td>
                    <td className="py-2 pr-3">{r.finalGrade !== null ? r.finalGrade.toFixed(1) : "—"}</td>
                    <td className="py-2 pr-3">
                      <StatusCell row={r} />
                    </td>
                    <td className="py-2">
                      <RowActions actionId={actionId} row={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-3 sm:hidden">
            {view.rows.map((r) => (
              <li key={r.enrollmentId} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.name}</span>
                  <StatusCell row={r} />
                </div>
                <span className="text-xs text-muted-foreground">
                  {r.run}
                  {/* Grupo (HU-2.2): sin código SENCE no hay grupo — se omite, no "· —". */}
                  {r.exento || view.senceGroupLabel
                    ? ` · ${r.exento ? BECARIO_LABEL : view.senceGroupLabel}`
                    : ""}{" "}
                  · {r.exento ? t.exento : `${r.attendancePct}%`} · {r.finalGrade !== null ? r.finalGrade.toFixed(1) : "—"}
                </span>
                <RowActions actionId={actionId} row={r} />
              </li>
            ))}
          </ul>
        </>
      )}

      <Link href="/admin/acciones" className="text-sm underline">
        {t.backToActions}
      </Link>
    </main>
  );
}

function StatusCell({ row }: { row: EligibilityRow }) {
  if (row.certificate?.status === "issued") {
    return <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900 dark:text-green-200">{t.issued}</span>;
  }
  if (row.certificate?.status === "revoked") {
    return <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-900 dark:text-red-200">{t.revoked}</span>;
  }
  if (row.eligible) {
    return <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-900 dark:text-blue-200">{t.eligible}</span>;
  }
  return (
    <span className="text-xs text-muted-foreground">
      {row.reasons.map((rr) => REASON_LABEL[rr]).join(" · ")}
    </span>
  );
}

function RowActions({ actionId, row }: { actionId: string; row: EligibilityRow }) {
  if (row.certificate?.status === "issued") {
    return (
      <span className="flex flex-wrap items-center gap-3">
        <a href={`/api/certificados/${row.certificate.id}`} className="min-h-11 text-sm underline">
          {t.download}
        </a>
        <RevokeForm certificateId={row.certificate.id} actionId={actionId} />
      </span>
    );
  }
  if (row.eligible) {
    return (
      <form action={issueCertificateAction}>
        <input type="hidden" name="enrollmentId" value={row.enrollmentId} />
        <input type="hidden" name="actionId" value={actionId} />
        <button type="submit" className="min-h-11 rounded-md border px-3 text-sm font-medium">
          {t.issue}
        </button>
      </form>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}
