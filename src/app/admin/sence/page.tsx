import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { getSenceConfigStatus } from "@/modules/core/sence-config";
import { SenceConfigForm } from "./sence-config-form";

export const dynamic = "force-dynamic";

/** Panel de configuración SENCE del OTEC (task 1.2, HU-5.4). Solo otec_admin. */
export default async function SenceAdminPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin"])) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{esCL.senceAdmin.forbidden}</p>
      </main>
    );
  }

  const status = await getSenceConfigStatus(principal);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{esCL.senceAdmin.title}</h1>
        <p className="text-muted-foreground text-sm">{esCL.senceAdmin.intro}</p>
      </header>
      <SenceConfigForm
        initialRut={status?.rutOtec ?? ""}
        initialEnvironment={status?.environment ?? "rcetest"}
        tokenConfigured={status?.tokenConfigured ?? false}
      />
    </main>
  );
}
