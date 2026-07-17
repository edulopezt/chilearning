import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { FEATURE_KEYS, type FeatureKey } from "@/modules/core/domain/features";
import { isSuperadmin } from "@/modules/core/domain/rbac";
import { listTenants } from "@/modules/core/tenant-service";
import { CreateTenantForm } from "./create-form";
import { reactivateTenantAction, suspendTenantAction, updateFlagsAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.superadmin;

const FLAG_LABEL: Record<FeatureKey, string> = {
  scorm: t.flagScorm,
  ai_tutor: t.flagAiTutor,
  whatsapp: t.flagWhatsapp,
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
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      <CreateTenantForm />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.tenantsHeading}</h2>
        {tenants.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tenants.map((tenant) => (
              <li key={tenant.id} className="flex flex-col gap-3 rounded-md border p-3 text-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex-1">
                    <p className="font-medium break-all">{tenant.name}</p>
                    <p className="text-muted-foreground text-xs">
                      <code className="font-mono">{tenant.slug}</code>
                      {" · "}
                      {t.planLabelShort}: {tenant.plan}
                    </p>
                  </div>
                  <span
                    className={`w-fit rounded px-2 py-0.5 text-xs ${
                      tenant.status === "active"
                        ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                    }`}
                  >
                    {tenant.status === "active" ? t.statusActive : t.statusSuspended}
                  </span>
                  <form action={tenant.status === "active" ? suspendTenantAction : reactivateTenantAction}>
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <button
                      type="submit"
                      className={`min-h-11 rounded-md border px-3 text-xs ${
                        tenant.status === "active" ? "text-red-600" : "text-green-700 dark:text-green-400"
                      }`}
                    >
                      {tenant.status === "active" ? t.suspend : t.reactivate}
                    </button>
                  </form>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                  <span className="text-muted-foreground text-xs">{t.flagsHeading}:</span>
                  {FEATURE_KEYS.map((key) => (
                    <form key={key} action={updateFlagsAction}>
                      <input type="hidden" name="tenantId" value={tenant.id} />
                      <input type="hidden" name="key" value={key} />
                      <input type="hidden" name="enabled" value={tenant.flags[key] ? "false" : "true"} />
                      <button
                        type="submit"
                        title={tenant.flags[key] ? t.flagOn : t.flagOff}
                        className={`min-h-11 rounded-md border px-3 text-xs ${
                          tenant.flags[key]
                            ? "border-green-300 bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"
                            : "text-muted-foreground"
                        }`}
                      >
                        {FLAG_LABEL[key]}: {tenant.flags[key] ? t.flagOn : t.flagOff}
                      </button>
                    </form>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
