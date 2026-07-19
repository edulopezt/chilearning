import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { getChecklist } from "@/modules/dj/dj-service";
import { DJ_STATES } from "@/modules/dj/domain/state-machine";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ensureChecklistAction, setDjStateAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.dj;

/** Checklist de DJ por acción (task 3.3, HU-5.6). Staff-only: otec_admin/coordinator
 *  gestionan, instructor lee. Sin supervisor (cumplimiento SENCE interno, ver 3.12). */
export default async function DjPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  const canView = principal.tenantId && authorize(principal, principal.tenantId, ["otec_admin", "coordinator", "instructor"]);
  if (!canView) {
    return <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6"><p className="text-muted-foreground">{t.forbidden}</p></main>;
  }
  const canManage = authorize(principal, principal.tenantId!, ["otec_admin", "coordinator"]);
  const { id: actionId } = await params;
  const rows = await getChecklist(principal, actionId);
  if (rows === null) redirect("/admin/acciones");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader title={t.title} description={t.intro} />

      <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
          <form action={ensureChecklistAction}>
            <input type="hidden" name="actionId" value={actionId} />
            <Button type="submit" variant="outline">{t.ensure}</Button>
          </form>
        ) : null}
        <a href={`/api/dj/roster/${actionId}?formato=xlsx`} className={cn(buttonVariants({ variant: "outline" }))}>{t.exportXlsx}</a>
        <a href={`/api/dj/roster/${actionId}?formato=csv`} className={cn(buttonVariants({ variant: "outline" }))}>{t.exportCsv}</a>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="gap-2 p-3 text-sm sm:flex-row sm:flex-wrap sm:items-center">
                <div className="flex-1">
                  <p className="font-medium">{r.apellidos} {r.nombres}</p>
                  <p className="text-xs text-muted-foreground">{r.run || "—"}</p>
                </div>
                <div className="flex flex-col gap-0.5 sm:items-end">
                  <Badge variant="secondary">{t.states[r.state]}</Badge>
                  {r.settlementDeadline ? (
                    <span className={`text-xs ${r.overdue ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                      {r.overdue ? `${t.overdue} · ${r.settlementDeadline}` : r.settlementDeadline}
                    </span>
                  ) : null}
                </div>
                {canManage ? (
                  <form action={setDjStateAction} className="flex flex-wrap items-center gap-1">
                    <input type="hidden" name="actionId" value={actionId} />
                    <input type="hidden" name="checklistId" value={r.id} />
                    <Select name="state" defaultValue={r.state}>
                      <SelectTrigger aria-label={t.changeState} className="w-auto">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DJ_STATES.map((s) => (<SelectItem key={s} value={s}>{t.states[s]}</SelectItem>))}
                      </SelectContent>
                    </Select>
                    <Input type="text" name="notes" placeholder={t.notesLabel} aria-label={t.notesLabel} className="w-40" />
                    <Button type="submit" variant="outline">{t.save}</Button>
                  </form>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Link href="/admin/acciones" className="text-sm underline underline-offset-4">{t.backToActions}</Link>
    </main>
  );
}
