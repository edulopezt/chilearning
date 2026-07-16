import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listGrants } from "@/modules/portal-empresa/supervisor-grant-service";
import { listComplianceActions } from "@/modules/reportes/cumplimiento-service";
import { InviteForm } from "./invite-form";
import { revokeGrantAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.supervisorGrants;

const STATUS_LABEL = { active: t.statusActive, expired: t.statusExpired, revoked: t.statusRevoked } as const;
const STATUS_CLASS = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  expired: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  revoked: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
} as const;

/** Gestión de fiscalizadores (task 3.11, HU-12.1/12.2). Staff: admin/coordinador. */
export default async function SupervisoresPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator"])) {
    return <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6"><p className="text-muted-foreground">{t.forbidden}</p></main>;
  }
  const [grants, actions] = await Promise.all([listGrants(principal), listComplianceActions(principal)]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      <InviteForm actions={actions.map((a) => ({ actionId: a.actionId, codigoAccion: a.codigoAccion, courseName: a.courseName }))} />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.listHeading}</h2>
        {(grants ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(grants ?? []).map((g) => (
              <li key={g.id} className="flex flex-col gap-2 rounded-md border p-3 text-sm sm:flex-row sm:flex-wrap sm:items-center">
                <div className="flex-1">
                  <p className="font-medium break-all">{g.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {g.scope === "tenant" ? t.scopeTenant : `${g.actionIds.length} ${t.actionsScoped}`}
                    {" · "}
                    {g.expiresAt ? `${t.colExpires}: ${g.expiresAt.slice(0, 10)}` : t.noExpiry}
                  </p>
                </div>
                <span className={`rounded px-2 py-0.5 text-xs ${STATUS_CLASS[g.status]}`}>{STATUS_LABEL[g.status]}</span>
                {g.status === "active" ? (
                  <form action={revokeGrantAction}>
                    <input type="hidden" name="grantId" value={g.id} />
                    <button type="submit" className="min-h-11 rounded-md border px-3 text-xs text-red-600">{t.revoke}</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
