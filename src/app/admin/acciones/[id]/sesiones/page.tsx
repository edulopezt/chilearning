import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listSessionsByAction } from "@/modules/academico/live-session-service";
import { SessionForm } from "./session-form";
import { DeleteSessionButton } from "./delete-session-button";

export const dynamic = "force-dynamic";

const t = esCL.liveSessions;

const VIEWERS = ["otec_admin", "coordinator", "instructor", "tutor"] as const;
const EDITORS = ["otec_admin", "coordinator", "instructor"] as const;

/**
 * Sesiones en vivo de una acción (task 5.4, spec §7-R3): agenda + edición +
 * enlace al roster de asistencia interna. La videoconferencia es externa
 * (Zoom/Meet/Teams); aquí solo se programa el enlace.
 */
export default async function LiveSessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  const { id: actionId } = await params;
  const { edit: editId } = await searchParams;

  const canView = Boolean(principal.tenantId) && authorize(principal, principal.tenantId!, VIEWERS);
  if (!canView) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.forbidden}</p>
      </main>
    );
  }
  const canManage = authorize(principal, principal.tenantId!, EDITORS);

  const sessions = await listSessionsByAction(principal, actionId);
  const editing = editId ? (sessions.find((s) => s.id === editId) ?? null) : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">{t.disclaimer}</p>
      </header>

      <section className="flex flex-col gap-3">
        {sessions.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3">{t.colTitle}</th>
                  <th className="py-2 pr-3">{t.colProvider}</th>
                  <th className="py-2 pr-3">{t.colWhen}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{s.title}</td>
                    <td className="py-2 pr-3">{t.providers[s.provider]}</td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {new Date(s.startsAtMs).toLocaleString("es-CL")} → {new Date(s.endsAtMs).toLocaleString("es-CL")}
                    </td>
                    <td className="py-2">
                      <span className="flex flex-wrap items-center gap-3">
                        <Link href={`/admin/acciones/${actionId}/sesiones/${s.id}`} className="underline">
                          {t.viewRoster}
                        </Link>
                        {canManage ? (
                          <>
                            <Link href={`/admin/acciones/${actionId}/sesiones?edit=${s.id}`} className="underline">
                              {t.edit}
                            </Link>
                            <DeleteSessionButton actionId={actionId} sessionId={s.id} />
                          </>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage ? (
        <section className="flex flex-col gap-3 border-t pt-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{editing ? t.editTitle : t.newTitle}</h2>
            {editing ? (
              <Link href={`/admin/acciones/${actionId}/sesiones`} className="text-sm underline">
                {t.cancelEdit}
              </Link>
            ) : null}
          </div>
          <SessionForm actionId={actionId} editing={editing} />
        </section>
      ) : null}

      <Link href="/admin/acciones" className="text-sm underline">
        {t.backToActions}
      </Link>
    </main>
  );
}
