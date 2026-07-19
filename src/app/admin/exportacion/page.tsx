import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listExports, type TenantExportRow } from "@/modules/reportes/tenant-export-service";
import { requestExportAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.tenantExport;

const STATUS_LABEL: Record<string, string> = {
  pending: t.statusPending,
  running: t.statusRunning,
  done: t.statusDone,
  failed: t.statusFailed,
};

const STATUS_BADGE_VARIANT: Record<string, "success" | "destructive" | "secondary"> = {
  pending: "secondary",
  running: "secondary",
  done: "success",
  failed: "destructive",
};

/** Export completo del tenant en formatos abiertos (task 5.13, HU-1.5). Solo otec_admin (RLS de `tenant_exports` exige lo mismo). */
export default async function TenantExportPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin"])) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.forbidden}</p>
      </main>
    );
  }

  const exports = await listExports(principal);
  const hasActive = exports.some((e) => e.status === "pending" || e.status === "running");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader title={t.title} description={t.intro} />

      <form action={requestExportAction} className="flex flex-col gap-2">
        <Button type="submit" variant="outline" disabled={hasActive} className="w-fit">
          {t.request}
        </Button>
        <p className="text-muted-foreground text-xs">{hasActive ? t.alreadyRunning : t.notice}</p>
      </form>

      {exports.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        <>
          {/* Móvil: tarjetas. ≥lg: tabla. Sin scroll horizontal (RNF-6). */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {exports.map((row) => (
              <ExportCard key={row.id} row={row} />
            ))}
          </ul>
          <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.colRequestedAt}</TableHead>
                  <TableHead>{t.colStatus}</TableHead>
                  <TableHead>{t.colSize}</TableHead>
                  <TableHead>{t.colAction}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exports.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{formatDateTime(row.requestedAt)}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>{formatBytes(row.fileSize)}</TableCell>
                    <TableCell>
                      {row.status === "done" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          render={<a href={`/api/reportes/exportacion/${row.id}`} />}
                        >
                          {t.download}
                        </Button>
                      ) : null}
                      {row.status === "failed" && row.error ? (
                        <p className="text-muted-foreground text-xs" title={row.error}>
                          {t.errorLabel}: {row.error}
                        </p>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status;
  const variant = STATUS_BADGE_VARIANT[status] ?? "secondary";
  return <Badge variant={variant}>{label}</Badge>;
}

function ExportCard({ row }: { row: TenantExportRow }) {
  return (
    <li>
      <Card className="gap-2 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{formatDateTime(row.requestedAt)}</span>
          <StatusBadge status={row.status} />
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>{formatBytes(row.fileSize)}</span>
          {row.status === "done" ? (
            <Button variant="outline" render={<a href={`/api/reportes/exportacion/${row.id}`} />}>
              {t.download}
            </Button>
          ) : null}
        </div>
        {row.status === "failed" && row.error ? (
          <p className="text-muted-foreground text-xs">
            {t.errorLabel}: {row.error}
          </p>
        ) : null}
      </Card>
    </li>
  );
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
