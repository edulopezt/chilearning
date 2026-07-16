import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listAnnouncements } from "@/modules/comunicacion/announcement-service";
import { listCalendar } from "@/modules/comunicacion/calendar-service";
import { listThreads } from "@/modules/comunicacion/forum-service";
import { createAnnouncementAction, createCalItemAction, publishAnnouncementAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.communication;

/** Comunicación del curso para el staff (task 3.4): anuncios + calendario + foro. */
export default async function AdminComunicacionPage({ params }: { params: Promise<{ courseId: string }> }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator", "instructor"])) {
    return <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6"><p className="text-muted-foreground">{t.forbidden}</p></main>;
  }
  const { courseId } = await params;
  const [announcements, calendar, threads] = await Promise.all([
    listAnnouncements(principal, { courseId }),
    listCalendar(principal, courseId),
    listThreads(principal, courseId),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold tracking-tight">{t.title}</h1>
        <Link href="/admin/mensajes" className="text-sm underline">{t.inboxTitle} →</Link>
      </div>

      {/* Anuncios */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.announcementsTitle}</h2>
        <ul className="flex flex-col gap-2">
          {announcements.length === 0 ? <p className="text-muted-foreground text-sm">{t.annEmpty}</p> : announcements.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3">
              <span className="flex-1 font-medium">{a.title}</span>
              <span className={`rounded px-2 py-0.5 text-xs ${a.status === "published" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800"}`}>{a.status === "published" ? t.published : t.draft}</span>
              {a.status !== "published" ? (
                <form action={publishAnnouncementAction}>
                  <input type="hidden" name="announcementId" value={a.id} />
                  <input type="hidden" name="courseId" value={courseId} />
                  <button type="submit" className="min-h-11 text-sm underline">{t.publish}</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        <form action={createAnnouncementAction} className="flex flex-col gap-2 border-t pt-3">
          <input type="hidden" name="courseId" value={courseId} />
          <input name="title" required placeholder={t.annTitleLabel} className="input" />
          <textarea name="body" required rows={2} placeholder={t.annBodyLabel} className="input" />
          <button type="submit" className="min-h-11 self-start rounded-md bg-neutral-900 px-4 text-sm font-medium text-white dark:bg-white dark:text-neutral-900">{t.newAnnouncement}</button>
        </form>
      </section>

      {/* Calendario */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.calendarTitle}</h2>
        <ul className="flex flex-col gap-2">
          {(calendar ?? []).length === 0 ? <p className="text-muted-foreground text-sm">{t.calEmpty}</p> : (calendar ?? []).map((c, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md border p-2 text-sm">
              <span className="text-muted-foreground">{new Date(c.dueAtMs).toLocaleString("es-CL")}</span>
              <span className="flex-1 font-medium">{c.title}</span>
              <span className="text-xs text-muted-foreground">{c.kind}{c.source === "instrument" ? " ·auto" : ""}</span>
            </li>
          ))}
        </ul>
        <form action={createCalItemAction} className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:flex-wrap sm:items-end">
          <input type="hidden" name="courseId" value={courseId} />
          <input name="title" required placeholder={t.calTitleLabel} className="input flex-1" />
          <input name="dueAt" type="datetime-local" required className="input" />
          <select name="kind" className="input"><option value="hito">hito</option><option value="plazo">plazo</option><option value="sesion">sesion</option><option value="otro">otro</option></select>
          <button type="submit" className="min-h-11 rounded-md border px-4 text-sm font-medium">{t.newCalItem}</button>
        </form>
      </section>

      {/* Foro */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.forumTitle}</h2>
        <ul className="flex flex-col gap-2">
          {(threads ?? []).length === 0 ? <p className="text-muted-foreground text-sm">{t.forumEmpty}</p> : (threads ?? []).map((th) => (
            <li key={th.id} className="flex items-center gap-2 rounded-md border p-3">
              <Link href={`/admin/cursos/${courseId}/comunicacion/foro/${th.id}`} className="flex-1 font-medium underline">{th.title}</Link>
              {th.resolved ? <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900 dark:text-green-200">{t.resolved}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <Link href={`/admin/cursos/${courseId}/lecciones`} className="text-sm underline">← {esCL.lessons.title}</Link>
    </main>
  );
}
