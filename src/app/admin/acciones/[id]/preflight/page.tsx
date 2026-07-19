import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { esCL } from "@/i18n/es-CL";
import { tenantGuard } from "@/lib/tenant-guard";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { getActionPreflight } from "@/modules/sence/preflight-service";
import type { ChecklistItem, ItemStatus } from "@/modules/sence/domain/action-preflight";
import { GuideForm } from "./guide-form";

export const dynamic = "force-dynamic";

const t = esCL.preflight;

const STATUS_VARIANT: Record<ItemStatus, "success" | "warning" | "destructive"> = {
  ok: "success",
  warning: "warning",
  error: "destructive",
};

const STATUS_SYMBOL: Record<ItemStatus, string> = {
  ok: "✓",
  warning: "⚠",
  error: "✕",
};

/** Pre-flight de una acción SENCE (task 2.7, HU-5.8). Admin/coordinador. */
export default async function PreflightPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  // La autorización es de la capa app (I-16: el servicio sence recibe el guard).
  if (
    !principal.tenantId ||
    !authorize(principal, principal.tenantId, ["otec_admin", "coordinator"])
  ) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.forbidden}</p>
      </main>
    );
  }

  const { id } = await params;
  const result = await getActionPreflight(tenantGuard(principal.tenantId), id);
  if (!result.ok) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.notFound}</p>
      </main>
    );
  }
  const { view } = result;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <PageHeader
        title={t.title}
        description={
          <>
            <span className="font-mono">{view.action.codigoAccion}</span>
            {" · "}
            {view.action.courseName}
            {" · "}
            {view.action.startsOn ?? "—"} → {view.action.endsOn ?? "—"}
            <br />
            {t.intro}
          </>
        }
      />

      <Alert variant={STATUS_VARIANT[view.checklist.overall]} role={view.checklist.overall === "error" ? "alert" : "status"}>
        <AlertDescription className="font-semibold">
          {STATUS_SYMBOL[view.checklist.overall]} {t.overall[view.checklist.overall]}
        </AlertDescription>
      </Alert>

      <section className="flex flex-col gap-2" aria-label={t.title}>
        {view.checklist.items.map((item) => (
          <ChecklistRow key={item.id} item={item} />
        ))}
        <p className="text-muted-foreground pt-1 text-xs">
          {view.totals.enrolled} {t.totals.enrolled} · {view.totals.exempt} {t.totals.exempt} ·{" "}
          {view.totals.invalid} {t.totals.invalid}
        </p>
      </section>

      {view.checklist.invalidRuns.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t.runsTable.title}</h2>
          <Table className="min-w-[24rem]">
            <TableHeader>
              <TableRow>
                <TableHead>{t.runsTable.colRun}</TableHead>
                <TableHead>{t.runsTable.colRule}</TableHead>
                <TableHead>{t.runsTable.colExempt}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.checklist.invalidRuns.map((r) => (
                <TableRow key={r.enrollmentId}>
                  <TableCell className="font-mono">{r.run || "—"}</TableCell>
                  <TableCell>{t.runsTable.rules[r.rule] ?? r.rule}</TableCell>
                  <TableCell>{r.exento ? t.runsTable.yes : t.runsTable.no}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      <section className="flex flex-col gap-3 border-t pt-6">
        <h2 className="text-lg font-semibold">{t.guide.title}</h2>
        <p className="text-muted-foreground text-sm">{t.guide.body}</p>
        <GuideForm actionId={view.action.id} />
      </section>

      <section className="flex flex-col gap-2 border-t pt-6">
        <h2 className="text-lg font-semibold">{t.day1.title}</h2>
        {view.day1Alert ? (
          <Alert variant="warning">
            <AlertDescription>{view.day1Alert.message}</AlertDescription>
          </Alert>
        ) : (
          <p className="text-muted-foreground text-sm">{t.day1.none}</p>
        )}
      </section>

      <p>
        <Link href="/admin/acciones" className="text-sm underline">
          ← {esCL.actions.title}
        </Link>
      </p>
    </main>
  );
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  const detail = (t.details as Record<string, string>)[item.detailKey] ?? item.detailKey;
  return (
    <Card className="flex-row items-start gap-3 p-3">
      <Badge variant={STATUS_VARIANT[item.status]} aria-hidden="true" className="mt-0.5">
        {STATUS_SYMBOL[item.status]}
      </Badge>
      <div className="flex flex-col">
        <span className="text-sm font-medium">{t.items[item.id]}</span>
        <span className="text-muted-foreground text-sm">
          {detail}
          {item.meta && "invalid" in item.meta ? (
            <>
              {" "}
              ({item.meta.invalid}/{item.meta.total})
            </>
          ) : null}
        </span>
      </div>
    </Card>
  );
}
