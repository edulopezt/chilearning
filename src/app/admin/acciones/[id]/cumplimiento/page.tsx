import Link from "next/link";
import { redirect } from "next/navigation";

import { CompliancePanelView } from "@/components/reportes/compliance-panel";
import { PageHeader } from "@/components/ui/page-header";
import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getCompliancePanel } from "@/modules/reportes/cumplimiento-service";

export const dynamic = "force-dynamic";

const t = esCL.cumplimiento;

/** Panel de cumplimiento SENCE por acción (task 2.4, HU-5.5). */
export default async function CompliancePage({
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
      <PageHeader
        title={t.title}
        description={
          <>
            <span className="font-mono">{panel.codigoAccion}</span>
            {" · "}
            {panel.courseName}
            {" · "}
            {panel.startsOn ?? "—"} → {panel.endsOn ?? "—"}
            <br />
            {t.intro}
          </>
        }
      />

      <CompliancePanelView
        panel={panel}
        exportBasePath={`/api/reportes/cumplimiento/${panel.actionId}`}
      />

      <p>
        <Link href="/admin/acciones" className="text-sm underline underline-offset-4">
          ← {esCL.actions.title}
        </Link>
      </p>
    </main>
  );
}
