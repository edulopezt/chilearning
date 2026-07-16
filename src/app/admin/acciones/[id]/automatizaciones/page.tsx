import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { getAutomationConfig } from "@/modules/comunicacion/automation-service";
import { setAutomationAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.automation;

/** Config de automatizaciones por acción (task 3.9, HU-5.9). Staff. */
export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator"])) {
    return <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6"><p className="text-muted-foreground">{t.forbidden}</p></main>;
  }
  const { id: actionId } = await params;
  const config = await getAutomationConfig(principal, actionId);
  if (config === null) redirect("/admin/acciones");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      <ul className="flex flex-col gap-3">
        {config.map((c) => (
          <li key={c.kind} className="rounded-md border p-4">
            <form action={setAutomationAction} className="flex flex-col gap-3">
              <input type="hidden" name="actionId" value={actionId} />
              <input type="hidden" name="kind" value={c.kind} />
              <div className="flex items-start gap-3">
                <input id={`en-${c.kind}`} type="checkbox" name="enabled" defaultChecked={c.enabled} className="mt-1 size-4" />
                <label htmlFor={`en-${c.kind}`} className="flex-1 text-sm font-medium">{t.kinds[c.kind]}</label>
              </div>
              {c.kind === "inactive" ? (
                <label className="flex items-center gap-2 text-sm">
                  <span>{t.inactiveDays}</span>
                  <input type="number" name="inactiveDays" min={1} max={60} defaultValue={c.settings.inactiveDays ?? 7} className="min-h-11 w-20 rounded-md border px-2" />
                </label>
              ) : null}
              <button type="submit" className="min-h-11 self-start rounded-md border px-4 text-sm font-medium">{t.save}</button>
            </form>
          </li>
        ))}
      </ul>

      <Link href="/admin/acciones" className="text-sm underline">{t.backToActions}</Link>
    </main>
  );
}
