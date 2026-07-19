import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
      <div className="flex flex-col gap-3">
        <PageHeader title={t.title} description={t.intro} />
        <Alert variant="warning">
          <AlertDescription>{t.disclaimer}</AlertDescription>
        </Alert>
      </div>

      <section className="flex flex-col gap-3">
        {sessions.length === 0 ? (
          <EmptyState title={t.empty} />
        ) : (
          <Table className="min-w-[36rem]">
            <TableHeader>
              <TableRow>
                <TableHead>{t.colTitle}</TableHead>
                <TableHead>{t.colProvider}</TableHead>
                <TableHead>{t.colWhen}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.title}</TableCell>
                  <TableCell>{t.providers[s.provider]}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(s.startsAtMs).toLocaleString("es-CL")} → {new Date(s.endsAtMs).toLocaleString("es-CL")}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-3">
                      <Link href={`/admin/acciones/${actionId}/sesiones/${s.id}`} className="text-sm underline">
                        {t.viewRoster}
                      </Link>
                      {canManage ? (
                        <>
                          <Link href={`/admin/acciones/${actionId}/sesiones?edit=${s.id}`} className="text-sm underline">
                            {t.edit}
                          </Link>
                          <DeleteSessionButton actionId={actionId} sessionId={s.id} />
                        </>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
