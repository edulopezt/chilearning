import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { getChecklist } from "@/modules/dj/dj-service";
import { DJ_STATES } from "@/modules/dj/domain/state-machine";
import { ensureChecklistAction, setDjStateAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.dj;

/** Checklist de DJ por acción (task 3.3, HU-5.6). Staff/coordinación gestiona; supervisor lee. */
export default async function DjPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  const canView = principal.tenantId && authorize(principal, principal.tenantId, ["otec_admin", "coordinator", "instructor", "supervisor"]);
  if (!canView) {
    return <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6"><p className="text-muted-foreground">{t.forbidden}</p></main>;
  }
  const canManage = authorize(principal, principal.tenantId!, ["otec_admin", "coordinator"]);
  const { id: actionId } = await params;
  const rows = await getChecklist(principal, actionId);
  if (rows === null) redirect("/admin/acciones");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
          <form action={ensureChecklistAction}>
            <input type="hidden" name="actionId" value={actionId} />
            <button type="submit" className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium">{t.ensure}</button>
          </form>
        ) : null}
        <a href={`/api/dj/roster/${actionId}?formato=xlsx`} className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium">{t.exportXlsx}</a>
        <a href={`/api/dj/roster/${actionId}?formato=csv`} className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium">{t.exportCsv}</a>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 rounded-md border p-3 text-sm sm:flex-row sm:flex-wrap sm:items-center">
              <div className="flex-1">
                <p className="font-medium">{r.apellidos} {r.nombres}</p>
                <p className="text-xs text-muted-foreground">{r.run || "—"}</p>
              </div>
              <div className="flex flex-col gap-0.5 sm:items-end">
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">{t.states[r.state]}</span>
                {r.settlementDeadline ? (
                  <span className={`text-xs ${r.overdue ? "font-semibold text-red-600" : "text-muted-foreground"}`}>
                    {r.overdue ? `${t.overdue} · ${r.settlementDeadline}` : r.settlementDeadline}
                  </span>
                ) : null}
              </div>
              {canManage ? (
                <form action={setDjStateAction} className="flex flex-wrap items-center gap-1">
                  <input type="hidden" name="actionId" value={actionId} />
                  <input type="hidden" name="checklistId" value={r.id} />
                  <label className="sr-only" htmlFor={`state-${r.id}`}>{t.changeState}</label>
                  <select id={`state-${r.id}`} name="state" defaultValue={r.state} className="min-h-11 rounded-md border px-2 text-sm">
                    {DJ_STATES.map((s) => (<option key={s} value={s}>{t.states[s]}</option>))}
                  </select>
                  <input type="text" name="notes" placeholder={t.notesLabel} className="min-h-11 rounded-md border px-2 text-sm" />
                  <button type="submit" className="min-h-11 rounded-md border px-3 text-sm font-medium">{t.save}</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Link href="/admin/acciones" className="text-sm underline">{t.backToActions}</Link>
    </main>
  );
}
