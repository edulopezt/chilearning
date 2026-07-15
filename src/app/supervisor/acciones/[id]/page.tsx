import Link from "next/link";
import { redirect } from "next/navigation";

import { CompliancePanelView } from "@/components/reportes/compliance-panel";
import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getCompliancePanel } from "@/modules/reportes/cumplimiento-service";

export const dynamic = "force-dynamic";

const t = esCL.supervisorPortal;

/**
 * El MISMO panel de cumplimiento que ve el coordinador (CA de HU-5.5), en el
 * portal simplificado del fiscalizador. Solo lectura: el servicio autoriza
 * (VIEWERS incluye supervisor) y la vista no monta mutación alguna.
 */
export default async function SupervisorActionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const { id } = await params;
  const panel = await getCompliancePanel(principal, id);
  if (!panel) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.forbidden}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{esCL.cumplimiento.title}</h1>
        <p className="text-sm">
          <span className="font-mono">{panel.codigoAccion}</span>
          {" · "}
          {panel.courseName}
          {" · "}
          <span className="text-muted-foreground">
            {panel.startsOn ?? "—"} → {panel.endsOn ?? "—"}
          </span>
        </p>
      </header>

      <CompliancePanelView
        panel={panel}
        exportBasePath={`/api/reportes/cumplimiento/${panel.actionId}`}
      />

      <p>
        <Link href="/supervisor" className="text-sm underline">
          ← {t.title}
        </Link>
      </p>
    </main>
  );
}
