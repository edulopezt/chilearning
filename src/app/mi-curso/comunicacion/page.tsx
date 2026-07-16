import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getStudentCourseView } from "@/modules/academico/course-view";
import { listPublishedAnnouncements } from "@/modules/comunicacion/announcement-service";
import { listCalendar } from "@/modules/comunicacion/calendar-service";
import { listThreads } from "@/modules/comunicacion/forum-service";
import { listMyThreads } from "@/modules/comunicacion/message-service";
import { createThreadAction, startMessageAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.communication;

/** Comunicación del alumno (task 3.4): anuncios, calendario, foro y mensajes. */
export default async function StudentComunicacionPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  const view = await getStudentCourseView();
  if (!view) redirect("/mi-curso");
  const courseId = view.courseId;

  const [announcements, calendar, threads, messages] = await Promise.all([
    listPublishedAnnouncements(principal, courseId),
    listCalendar(principal, courseId),
    listThreads(principal, courseId),
    listMyThreads(principal, courseId),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 p-4 sm:p-6">
      <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.announcementsTitle}</h2>
        {announcements.length === 0 ? <p className="text-muted-foreground text-sm">{t.annEmpty}</p> : (
          <ul className="flex flex-col gap-2">
            {announcements.map((a) => (
              <li key={a.id} className="rounded-lg border p-3">
                <p className="font-medium">{a.title}</p>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.calendarTitle}</h2>
        {(calendar ?? []).length === 0 ? <p className="text-muted-foreground text-sm">{t.calEmpty}</p> : (
          <ul className="flex flex-col gap-1">
            {(calendar ?? []).map((c, i) => (
              <li key={i} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                <span className="text-muted-foreground">{new Date(c.dueAtMs).toLocaleString("es-CL")}</span>
                <span className="flex-1 font-medium">{c.title}</span>
                <span className="text-xs text-muted-foreground">{c.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.forumTitle}</h2>
        {(threads ?? []).length === 0 ? <p className="text-muted-foreground text-sm">{t.forumEmpty}</p> : (
          <ul className="flex flex-col gap-2">
            {(threads ?? []).map((th) => (
              <li key={th.id} className="flex items-center gap-2 rounded-md border p-3">
                <Link href={`/mi-curso/comunicacion/foro/${th.id}`} className="flex-1 underline">{th.title}</Link>
                {th.resolved ? <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900 dark:text-green-200">{t.resolved}</span> : null}
              </li>
            ))}
          </ul>
        )}
        <form action={createThreadAction} className="flex flex-col gap-2 border-t pt-3">
          <input type="hidden" name="courseId" value={courseId} />
          <input name="title" required placeholder={t.threadTitleLabel} className="input" />
          <textarea name="body" required rows={2} placeholder={t.postBodyLabel} className="input" />
          <button type="submit" className="min-h-11 self-start rounded-md border px-4 text-sm font-medium">{t.newThread}</button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.messagesTitle}</h2>
        {messages.length === 0 ? <p className="text-muted-foreground text-sm">{t.messageEmpty}</p> : (
          <ul className="flex flex-col gap-2">
            {messages.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-md border p-3">
                <Link href={`/mi-curso/comunicacion/mensaje/${m.id}`} className="flex-1 underline">{m.subject}</Link>
              </li>
            ))}
          </ul>
        )}
        <form action={startMessageAction} className="flex flex-col gap-2 border-t pt-3">
          <input type="hidden" name="courseId" value={courseId} />
          <input name="subject" required placeholder={t.subjectLabel} className="input" />
          <textarea name="body" required rows={2} placeholder={t.postBodyLabel} className="input" />
          <button type="submit" className="min-h-11 self-start rounded-md border px-4 text-sm font-medium">{t.newMessage}</button>
        </form>
      </section>

      <Link href="/mi-curso" className="text-sm underline">← {t.backToCourse}</Link>
    </main>
  );
}
