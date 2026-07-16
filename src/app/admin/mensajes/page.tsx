import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listMyThreads } from "@/modules/comunicacion/message-service";
import type { Sla } from "@/modules/comunicacion/domain/communication";

export const dynamic = "force-dynamic";

const t = esCL.communication;

const SLA_BADGE: Record<Sla, { label: string; cls: string }> = {
  answered: { label: t.slaAnswered, cls: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300" },
  green: { label: t.slaGreen, cls: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  amber: { label: t.slaAmber, cls: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
  red: { label: t.slaRed, cls: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
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
      <h1 className="text-2xl font-bold tracking-tight">{t.inboxTitle}</h1>
      {threads.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.inboxEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {threads.map((th) => {
            const badge = SLA_BADGE[th.sla];
            return (
              <li key={th.id} className="flex items-center gap-3 rounded-lg border p-3">
                <Link href={`/admin/mensajes/${th.id}`} className="flex-1 font-medium underline">{th.subject}</Link>
                <span className={`rounded px-2 py-0.5 text-xs ${badge.cls}`}>{badge.label}</span>
                <span className="text-xs text-muted-foreground">{new Date(th.lastMessageAt).toLocaleDateString("es-CL")}</span>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
