import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listMyThreads } from "@/modules/comunicacion/message-service";
import type { Sla } from "@/modules/comunicacion/domain/communication";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

const t = esCL.communication;

const SLA_BADGE: Record<Sla, { label: string; variant: React.ComponentProps<typeof Badge>["variant"] }> = {
  answered: { label: t.slaAnswered, variant: "secondary" },
  green: { label: t.slaGreen, variant: "success" },
  amber: { label: t.slaAmber, variant: "warning" },
  red: { label: t.slaRed, variant: "destructive" },
};

/** Bandeja de mensajes del staff con semáforo de tiempo de respuesta (HU-9.3). */
export default async function StaffInboxPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator", "instructor", "tutor"])) {
    return <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6"><p className="text-muted-foreground">{t.forbidden}</p></main>;
  }
  const threads = await listMyThreads(principal);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader title={t.inboxTitle} />
      {threads.length === 0 ? (
        <EmptyState title={t.inboxEmpty} />
      ) : (
        <ul className="flex flex-col gap-2">
          {threads.map((th) => {
            const badge = SLA_BADGE[th.sla];
            return (
              <li key={th.id}>
                <Card className="flex-row items-center gap-3 p-3">
                  <Link href={`/admin/mensajes/${th.id}`} className="flex-1 font-medium underline">{th.subject}</Link>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(th.lastMessageAt).toLocaleDateString("es-CL")}</span>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
