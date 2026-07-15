import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { tenantGuard } from "@/lib/tenant-guard";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { ActivateForm } from "./activate-form";

export const dynamic = "force-dynamic";

const t = esCL.actions;

/** Activar una acción en borrador (task 2.8): fija código + fechas y activa. */
export default async function ActivateActionPage({
  params,
}: {
  params: Promise<{ actionId: string }>;
}) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator"])) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.forbidden}</p>
      </main>
    );
  }

  const { actionId } = await params;
  const guard = tenantGuard(principal.tenantId);
  const { data: action } = await guard.db
    .from("actions")
    .select("id, codigo_accion, starts_on, ends_on, status, cloned_from")
    .eq("id", actionId)
    .eq("tenant_id", principal.tenantId)
    .maybeSingle();
  if (!action) redirect("/admin/acciones");
  // Ya activa: no hay nada que activar.
  if (action.status === "active") redirect("/admin/acciones");

  // Si es re-ejecución, muestra el código de origen (que NO se puede reusar).
  let originCode: string | null = null;
  if (action.cloned_from) {
    const { data: origin } = await guard.db
      .from("actions")
      .select("codigo_accion")
      .eq("id", action.cloned_from as string)
      .eq("tenant_id", principal.tenantId)
      .maybeSingle();
    originCode = (origin?.codigo_accion as string | undefined) ?? null;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.activateTitle}</h1>
        <p className="text-muted-foreground text-sm">{t.activateIntro}</p>
        {originCode ? (
          <p className="text-muted-foreground text-sm">
            {t.activateOrigin} <span className="font-mono">{originCode}</span>
          </p>
        ) : null}
      </header>

      <ActivateForm
        actionId={action.id as string}
        currentCode={action.codigo_accion as string}
        startsOn={action.starts_on as string | null}
        endsOn={action.ends_on as string | null}
      />

      <p>
        <Link href="/admin/acciones" className="text-sm underline">
          ← {t.title}
        </Link>
      </p>
    </main>
  );
}
