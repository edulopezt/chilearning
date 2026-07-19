import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { cn } from "@/lib/utils";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { BECARIO_LABEL } from "@/modules/academico/domain/enrollment-group";
import { getActionEligibility, type EligibilityRow } from "@/modules/certificados/certificates-service";
import type { EligibilityReason } from "@/modules/certificados/domain/eligibility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
      <PageHeader
        title={t.title}
        description={
          <>
            <span className="block">
              {view.courseName} · {view.code}
            </span>
            {view.isSence ? (
              <span className="block">
                {t.thresholdNote}: <strong>{view.minAttendancePct}%</strong>
              </span>
            ) : null}
          </>
        }
      />

      {view.rows.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        <>
          <form action={issueBatchAction}>
            <input type="hidden" name="actionId" value={actionId} />
            <Button type="submit">{t.issueAll}</Button>
          </form>

          {/* Tabla ≥sm, tarjetas <sm (RNF-6) */}
          <div className="hidden sm:block">
            <Table className="min-w-[44rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>{t.colStudent}</TableHead>
                  <TableHead>{t.colGroup}</TableHead>
                  <TableHead>{t.colAttendance}</TableHead>
                  <TableHead>{t.colGrade}</TableHead>
                  <TableHead>{t.colStatus}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.rows.map((r) => (
                  <TableRow key={r.enrollmentId} className="align-top">
                    <TableCell>
                      {r.name}
                      <span className="block text-xs text-muted-foreground">{r.run}</span>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {r.exento ? BECARIO_LABEL : (view.senceGroupLabel ?? "—")}
                    </TableCell>
                    <TableCell>{r.exento ? t.exento : `${r.attendancePct}%`}</TableCell>
                    <TableCell>{r.finalGrade !== null ? r.finalGrade.toFixed(1) : "—"}</TableCell>
                    <TableCell>
                      <StatusCell row={r} />
                    </TableCell>
                    <TableCell>
                      <RowActions actionId={actionId} row={r} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="flex flex-col gap-3 sm:hidden">
            {view.rows.map((r) => (
              <li key={r.enrollmentId}>
                <Card className="gap-2 p-3">
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
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      <Link href="/admin/acciones" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start")}>
        {t.backToActions}
      </Link>
    </main>
  );
}

function StatusCell({ row }: { row: EligibilityRow }) {
  if (row.certificate?.status === "issued") {
    return <Badge variant="success">{t.issued}</Badge>;
  }
  if (row.certificate?.status === "revoked") {
    return <Badge variant="destructive">{t.revoked}</Badge>;
  }
  if (row.eligible) {
    return <Badge variant="outline">{t.eligible}</Badge>;
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
        <Button variant="ghost" render={<a href={`/api/certificados/${row.certificate.id}`} />}>
          {t.download}
        </Button>
        <RevokeForm certificateId={row.certificate.id} actionId={actionId} />
      </span>
    );
  }
  if (row.eligible) {
    return (
      <form action={issueCertificateAction}>
        <input type="hidden" name="enrollmentId" value={row.enrollmentId} />
        <input type="hidden" name="actionId" value={actionId} />
        <Button type="submit" variant="outline">
          {t.issue}
        </Button>
      </form>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}
