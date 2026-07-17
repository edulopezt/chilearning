import { redirect } from "next/navigation";

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
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      <form action={requestExportAction} className="flex flex-col gap-2">
        <button
          type="submit"
          disabled={hasActive}
          className="min-h-11 w-fit rounded-md border px-4 text-sm font-medium disabled:opacity-50"
        >
          {t.request}
        </button>
        <p className="text-muted-foreground text-xs">{hasActive ? t.alreadyRunning : t.notice}</p>
      </form>

      {exports.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.empty}</p>
      ) : (
        <>
          {/* Móvil: tarjetas. ≥lg: tabla. Sin scroll horizontal (RNF-6). */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {exports.map((row) => (
              <ExportCard key={row.id} row={row} />
            ))}
          </ul>
          <div className="hidden lg:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3">{t.colRequestedAt}</th>
                  <th className="py-2 pr-3">{t.colStatus}</th>
                  <th className="py-2 pr-3">{t.colSize}</th>
                  <th className="py-2">{t.colAction}</th>
                </tr>
              </thead>
              <tbody>
                {exports.map((row) => (
                  <tr key={row.id} className="border-b">
                    <td className="py-2 pr-3">{formatDateTime(row.requestedAt)}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="py-2 pr-3">{formatBytes(row.fileSize)}</td>
                    <td className="py-2">
                      {row.status === "done" ? (
                        <a
                          href={`/api/reportes/exportacion/${row.id}`}
                          className="inline-flex min-h-11 items-center rounded-md border px-3 text-xs font-medium"
                        >
                          {t.download}
                        </a>
                      ) : null}
                      {row.status === "failed" && row.error ? (
                        <p className="text-muted-foreground text-xs" title={row.error}>
                          {t.errorLabel}: {row.error}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const label = STATUS_LABEL[status] ?? status;
  const color =
    status === "done"
      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      : status === "failed"
        ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
        : "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  return <span className={`rounded px-2 py-0.5 text-xs ${color}`}>{label}</span>;
}

function ExportCard({ row }: { row: TenantExportRow }): React.ReactElement {
  return (
    <li className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{formatDateTime(row.requestedAt)}</span>
        <StatusBadge status={row.status} />
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>{formatBytes(row.fileSize)}</span>
        {row.status === "done" ? (
          <a href={`/api/reportes/exportacion/${row.id}`} className="inline-flex min-h-11 items-center rounded-md border px-3 font-medium">
            {esCL.tenantExport.download}
          </a>
        ) : null}
      </div>
      {row.status === "failed" && row.error ? (
        <p className="text-muted-foreground text-xs">
          {esCL.tenantExport.errorLabel}: {row.error}
        </p>
      ) : null}
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
