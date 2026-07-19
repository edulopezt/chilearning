import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getStudentCourseView } from "@/modules/academico/course-view";
import { listPublishedAnnouncements } from "@/modules/comunicacion/announcement-service";
import { listCalendar } from "@/modules/comunicacion/calendar-service";
import { listThreads } from "@/modules/comunicacion/forum-service";
import { listMyThreads } from "@/modules/comunicacion/message-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldControl, FieldRoot } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
        {announcements.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.annEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {announcements.map((a) => (
              <li key={a.id}>
                <Card className="gap-1 p-3">
                  <p className="font-medium">{a.title}</p>
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">{a.body}</p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.calendarTitle}</h2>
        {(calendar ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.calEmpty}</p>
        ) : (
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
        {(threads ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.forumEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(threads ?? []).map((th) => (
              <li key={th.id} className="flex items-center gap-2 rounded-md border p-3">
                <Link href={`/mi-curso/comunicacion/foro/${th.id}`} className="flex-1 underline underline-offset-4">
                  {th.title}
                </Link>
                {th.resolved ? <Badge variant="success">{t.resolved}</Badge> : null}
              </li>
            ))}
          </ul>
        )}
        <form action={createThreadAction} className="flex flex-col gap-3 border-t pt-3">
          <input type="hidden" name="courseId" value={courseId} />
          <FieldRoot>
            <FieldControl render={<Input name="title" required placeholder={t.threadTitleLabel} />} />
          </FieldRoot>
          <FieldRoot>
            <FieldControl render={<Textarea name="body" required rows={2} placeholder={t.postBodyLabel} />} />
          </FieldRoot>
          <Button type="submit" variant="outline" className="self-start">
            {t.newThread}
          </Button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.messagesTitle}</h2>
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.messageEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-md border p-3">
                <Link href={`/mi-curso/comunicacion/mensaje/${m.id}`} className="flex-1 underline underline-offset-4">
                  {m.subject}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <form action={startMessageAction} className="flex flex-col gap-3 border-t pt-3">
          <input type="hidden" name="courseId" value={courseId} />
          <FieldRoot>
            <FieldControl render={<Input name="subject" required placeholder={t.subjectLabel} />} />
          </FieldRoot>
          <FieldRoot>
            <FieldControl render={<Textarea name="body" required rows={2} placeholder={t.postBodyLabel} />} />
          </FieldRoot>
          <Button type="submit" variant="outline" className="self-start">
            {t.newMessage}
          </Button>
        </form>
      </section>

      <Link href="/mi-curso" className="text-sm underline underline-offset-4">
        ← {t.backToCourse}
      </Link>
    </main>
  );
}
