import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listGrants } from "@/modules/portal-empresa/supervisor-grant-service";
import { listComplianceActions } from "@/modules/reportes/cumplimiento-service";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { InviteForm } from "./invite-form";
import { RevokeGrantButton } from "./revoke-grant-button";

export const dynamic = "force-dynamic";

const t = esCL.supervisorGrants;

const STATUS_LABEL = { active: t.statusActive, expired: t.statusExpired, revoked: t.statusRevoked } as const;
const STATUS_VARIANT = { active: "success", expired: "warning", revoked: "destructive" } as const;

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
      <PageHeader title={t.title} description={t.intro} />

      <InviteForm actions={actions.map((a) => ({ actionId: a.actionId, codigoAccion: a.codigoAccion, courseName: a.courseName }))} />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.listHeading}</h2>
        {(grants ?? []).length === 0 ? (
          <EmptyState title={t.empty} />
        ) : (
          <ul className="flex flex-col gap-2">
            {(grants ?? []).map((g) => (
              <li key={g.id}>
                <Card className="flex-col gap-2 p-3 text-sm sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="flex-1">
                    <p className="font-medium break-all">{g.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {g.scope === "tenant" ? t.scopeTenant : `${g.actionIds.length} ${t.actionsScoped}`}
                      {" · "}
                      {g.expiresAt ? `${t.colExpires}: ${g.expiresAt.slice(0, 10)}` : t.noExpiry}
                    </p>
                  </div>
                  <Badge variant={STATUS_VARIANT[g.status]}>{STATUS_LABEL[g.status]}</Badge>
                  {g.status === "active" ? <RevokeGrantButton grantId={g.id} /> : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
