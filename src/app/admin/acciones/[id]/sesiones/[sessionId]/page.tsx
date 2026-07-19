import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldControl, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { getSessionById, rosterForSession } from "@/modules/academico/live-session-service";
import { markAttendanceAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.liveSessions;

const VIEWERS = ["otec_admin", "coordinator", "instructor", "tutor"] as const;
const EDITORS = ["otec_admin", "coordinator", "instructor"] as const;

/**
 * Roster de asistencia INTERNA de una sesión en vivo (task 5.4, spec §7-R3).
 * El banner del disclaimer es PERMANENTE: esta asistencia no reemplaza el
 * registro de asistencia SENCE ni afecta el candado de contenido.
 */
export default async function LiveSessionRosterPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  const { id: actionId, sessionId } = await params;

  const canView = Boolean(principal.tenantId) && authorize(principal, principal.tenantId!, VIEWERS);
  if (!canView) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.forbidden}</p>
      </main>
    );
  }
  const canManage = authorize(principal, principal.tenantId!, EDITORS);

  const [session, roster] = await Promise.all([
    getSessionById(principal, sessionId),
    rosterForSession(principal, sessionId),
  ]);
  if (!session || roster === null || session.actionId !== actionId) redirect(`/admin/acciones/${actionId}/sesiones`);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title={session.title}
        description={
          <>
            {t.providers[session.provider]} · {new Date(session.startsAtMs).toLocaleString("es-CL")} →{" "}
            {new Date(session.endsAtMs).toLocaleString("es-CL")}
          </>
        }
      />

      {/* Banner PERMANENTE y visible (hard rule de esta tarea): esta asistencia
          es interna, no SENCE. */}
      <Alert variant="warning">
        <AlertDescription className="font-medium">{t.disclaimer}</AlertDescription>
      </Alert>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t.rosterTitle}</h2>
          <a href={`/api/reportes/asistencia-interna/${sessionId}`} className="text-sm underline">
            {t.exportCsv}
          </a>
        </div>

        {roster.length === 0 ? (
          <EmptyState title={t.rosterEmpty} />
        ) : (
          <ul className="flex flex-col gap-2">
            {roster.map((r) => (
              <li key={r.enrollmentId}>
                <Card className="gap-2 p-3 text-sm sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="flex-1">
                    <p className="font-medium">{r.apellidos} {r.nombres}</p>
                    {r.source ? (
                      <span className="text-muted-foreground text-xs">
                        {r.source === "self" ? t.originSelf : t.originManual}
                      </span>
                    ) : null}
                  </div>
                  {canManage ? (
                    <form action={markAttendanceAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="actionId" value={actionId} />
                      <input type="hidden" name="sessionId" value={sessionId} />
                      <input type="hidden" name="enrollmentId" value={r.enrollmentId} />
                      <Label className="min-h-11">
                        <input
                          type="radio"
                          name="present"
                          value="true"
                          defaultChecked={r.present !== false}
                          className="size-4 accent-primary"
                        />
                        {t.present}
                      </Label>
                      <Label className="min-h-11">
                        <input
                          type="radio"
                          name="present"
                          value="false"
                          defaultChecked={r.present === false}
                          className="size-4 accent-primary"
                        />
                        {t.absent}
                      </Label>
                      <FieldRoot className="flex-1">
                        <FieldLabel className="sr-only">{t.noteLabel}</FieldLabel>
                        <FieldControl
                          name="note"
                          type="text"
                          defaultValue={r.note}
                          maxLength={500}
                          placeholder={t.noteLabel}
                        />
                      </FieldRoot>
                      <Button type="submit" variant="outline">
                        {t.saveRoster}
                      </Button>
                    </form>
                  ) : r.present !== null ? (
                    <span className="text-sm">{r.present ? t.present : t.absent}</span>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href={`/admin/acciones/${actionId}/sesiones`} className="text-sm underline">
        ← {t.title}
      </Link>
    </main>
  );
}
