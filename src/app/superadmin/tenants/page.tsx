import { Building2Icon } from "lucide-react";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { FEATURE_KEYS, type FeatureKey } from "@/modules/core/domain/features";
import { isSuperadmin } from "@/modules/core/domain/rbac";
import { listTenants } from "@/modules/core/tenant-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { CreateTenantForm } from "./create-form";
import { SuspendTenantButton } from "./suspend-tenant-button";
import { reactivateTenantAction, updateFlagsAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.superadmin;

const FLAG_LABEL: Record<FeatureKey, string> = {
  scorm: t.flagScorm,
  ai_tutor: t.flagAiTutor,
  whatsapp: t.flagWhatsapp,
};

const PLAN_LABEL: Record<string, string> = {
  standard: t.planStandard,
  pro: t.planPro,
  enterprise: t.planEnterprise,
};

/** Panel de tenants (task 5.3, HU-1.1/1.4/1.3). Solo superadmin (claim). */
export default async function TenantsPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (!isSuperadmin(principal)) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.forbidden}</p>
      </main>
    );
  }

  const tenants = (await listTenants(principal)) ?? [];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader title={t.title} description={t.intro} />

      <CreateTenantForm />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.tenantsHeading}</h2>
        {tenants.length === 0 ? (
          <EmptyState icon={<Building2Icon />} title={t.empty} />
        ) : (
          <ul className="flex flex-col gap-2">
            {tenants.map((tenant) => (
              <li key={tenant.id}>
                <Card className="flex flex-col gap-3 p-3 text-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="flex-1">
                      <p className="font-medium break-all">{tenant.name}</p>
                      <p className="text-muted-foreground text-xs">
                        <code className="font-mono">{tenant.slug}</code>
                        {" · "}
                        {t.planLabelShort}: {PLAN_LABEL[tenant.plan] ?? tenant.plan}
                      </p>
                    </div>
                    <Badge variant={tenant.status === "active" ? "success" : "warning"}>
                      {tenant.status === "active" ? t.statusActive : t.statusSuspended}
                    </Badge>
                    {tenant.status === "active" ? (
                      <SuspendTenantButton tenantId={tenant.id} />
                    ) : (
                      <form action={reactivateTenantAction}>
                        <input type="hidden" name="tenantId" value={tenant.id} />
                        <Button type="submit" variant="outline">
                          {t.reactivate}
                        </Button>
                      </form>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                    <span className="text-muted-foreground text-xs">{t.flagsHeading}:</span>
                    {FEATURE_KEYS.map((key) => (
                      <form key={key} action={updateFlagsAction}>
                        <input type="hidden" name="tenantId" value={tenant.id} />
                        <input type="hidden" name="key" value={key} />
                        <input type="hidden" name="enabled" value={tenant.flags[key] ? "false" : "true"} />
                        <Button
                          type="submit"
                          variant={tenant.flags[key] ? "secondary" : "outline"}
                          title={tenant.flags[key] ? t.flagOn : t.flagOff}
                        >
                          {FLAG_LABEL[key]}: {tenant.flags[key] ? t.flagOn : t.flagOff}
                        </Button>
                      </form>
                    ))}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
