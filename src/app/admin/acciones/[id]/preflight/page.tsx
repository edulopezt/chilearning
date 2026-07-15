import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { tenantGuard } from "@/lib/tenant-guard";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { getActionPreflight } from "@/modules/sence/preflight-service";
import type { ChecklistItem, ItemStatus } from "@/modules/sence/domain/action-preflight";
import { GuideForm } from "./guide-form";

export const dynamic = "force-dynamic";

const t = esCL.preflight;

const STATUS_STYLE: Record<ItemStatus, { badge: string; symbol: string }> = {
  ok: { badge: "text-green-700 dark:text-green-400", symbol: "✓" },
  warning: { badge: "text-amber-700 dark:text-amber-400", symbol: "⚠" },
  error: { badge: "text-red-600", symbol: "✕" },
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
  const overall = STATUS_STYLE[view.checklist.overall];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-sm">
          <span className="font-mono">{view.action.codigoAccion}</span>
          {" · "}
          {view.action.courseName}
          {" · "}
          <span className="text-muted-foreground">
            {view.action.startsOn ?? "—"} → {view.action.endsOn ?? "—"}
          </span>
        </p>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      <p className={`text-sm font-semibold ${overall.badge}`} aria-live="polite">
        {overall.symbol} {t.overall[view.checklist.overall]}
      </p>

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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[24rem] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3">{t.runsTable.colRun}</th>
                  <th className="py-2 pr-3">{t.runsTable.colRule}</th>
                  <th className="py-2">{t.runsTable.colExempt}</th>
                </tr>
              </thead>
              <tbody>
                {view.checklist.invalidRuns.map((r) => (
                  <tr key={r.enrollmentId} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3 font-mono">{r.run || "—"}</td>
                    <td className="py-2 pr-3">
                      {t.runsTable.rules[r.rule] ?? r.rule}
                    </td>
                    <td className="py-2">{r.exento ? t.runsTable.yes : t.runsTable.no}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          <p className="text-sm text-amber-700 dark:text-amber-400">{view.day1Alert.message}</p>
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
  const style = STATUS_STYLE[item.status];
  const detail = (t.details as Record<string, string>)[item.detailKey] ?? item.detailKey;
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <span aria-hidden className={`mt-0.5 font-bold ${style.badge}`}>
        {style.symbol}
      </span>
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
    </div>
  );
}
