import Link from "next/link";
import { redirect } from "next/navigation";

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
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{session.title}</h1>
        <p className="text-muted-foreground text-sm">
          {t.providers[session.provider]} · {new Date(session.startsAtMs).toLocaleString("es-CL")} →{" "}
          {new Date(session.endsAtMs).toLocaleString("es-CL")}
        </p>
      </header>

      {/* Banner PERMANENTE y visible (hard rule de esta tarea): esta asistencia
          es interna, no SENCE. */}
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        {t.disclaimer}
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t.rosterTitle}</h2>
          <a href={`/api/reportes/asistencia-interna/${sessionId}`} className="text-sm underline">
            {t.exportCsv}
          </a>
        </div>

        {roster.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.rosterEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {roster.map((r) => (
              <li key={r.enrollmentId} className="flex flex-col gap-2 rounded-md border p-3 text-sm sm:flex-row sm:flex-wrap sm:items-center">
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
                    <label className="flex items-center gap-1">
                      <input type="radio" name="present" value="true" defaultChecked={r.present !== false} className="size-4" />
                      {t.present}
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="present" value="false" defaultChecked={r.present === false} className="size-4" />
                      {t.absent}
                    </label>
                    <label className="sr-only" htmlFor={`note-${r.enrollmentId}`}>{t.noteLabel}</label>
                    <input
                      id={`note-${r.enrollmentId}`}
                      type="text"
                      name="note"
                      defaultValue={r.note}
                      maxLength={500}
                      placeholder={t.noteLabel}
                      className="input min-h-11 flex-1"
                    />
                    <button type="submit" className="min-h-11 rounded-md border px-3 text-sm font-medium">
                      {t.saveRoster}
                    </button>
                  </form>
                ) : r.present !== null ? (
                  <span className="text-sm">{r.present ? t.present : t.absent}</span>
                ) : null}
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
