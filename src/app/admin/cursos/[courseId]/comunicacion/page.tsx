import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listAnnouncements } from "@/modules/comunicacion/announcement-service";
import { listCalendar } from "@/modules/comunicacion/calendar-service";
import { listThreads } from "@/modules/comunicacion/forum-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldControl, FieldRoot } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
      <PageHeader title={t.title} actions={<Link href="/admin/mensajes" className="text-sm underline underline-offset-4">{t.inboxTitle} →</Link>} />

      {/* Anuncios */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.announcementsTitle}</h2>
        <ul className="flex flex-col gap-2">
          {announcements.length === 0 ? <p className="text-sm text-muted-foreground">{t.annEmpty}</p> : announcements.map((a) => (
            <li key={a.id}>
              <Card className="flex-row flex-wrap items-center gap-2 p-3">
                <span className="flex-1 font-medium">{a.title}</span>
                <Badge variant={a.status === "published" ? "success" : "secondary"}>{a.status === "published" ? t.published : t.draft}</Badge>
                {a.status !== "published" ? (
                  <form action={publishAnnouncementAction}>
                    <input type="hidden" name="announcementId" value={a.id} />
                    <input type="hidden" name="courseId" value={courseId} />
                    <Button type="submit" variant="ghost" size="sm">{t.publish}</Button>
                  </form>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
        <form action={createAnnouncementAction} className="flex flex-col gap-2 border-t pt-3">
          <input type="hidden" name="courseId" value={courseId} />
          <FieldRoot>
            <FieldControl name="title" required placeholder={t.annTitleLabel} />
          </FieldRoot>
          <FieldRoot>
            <FieldControl name="body" required placeholder={t.annBodyLabel} render={<Textarea rows={2} />} />
          </FieldRoot>
          <Button type="submit" className="self-start">{t.newAnnouncement}</Button>
        </form>
      </section>

      {/* Calendario */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.calendarTitle}</h2>
        <ul className="flex flex-col gap-2">
          {(calendar ?? []).length === 0 ? <p className="text-sm text-muted-foreground">{t.calEmpty}</p> : (calendar ?? []).map((c, i) => (
            <li key={i}>
              <Card className="flex-row items-center gap-2 p-2 text-sm">
                <span className="text-muted-foreground">{new Date(c.dueAtMs).toLocaleString("es-CL")}</span>
                <span className="flex-1 font-medium">{c.title}</span>
                <span className="text-xs text-muted-foreground">{c.kind}{c.source === "instrument" ? " ·auto" : ""}</span>
              </Card>
            </li>
          ))}
        </ul>
        <form action={createCalItemAction} className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:flex-wrap sm:items-end">
          <input type="hidden" name="courseId" value={courseId} />
          <FieldRoot className="flex-1">
            <FieldControl name="title" required placeholder={t.calTitleLabel} />
          </FieldRoot>
          <FieldRoot>
            <FieldControl name="dueAt" type="datetime-local" required />
          </FieldRoot>
          <Select name="kind" defaultValue="hito">
            <SelectTrigger className="sm:w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hito">hito</SelectItem>
              <SelectItem value="plazo">plazo</SelectItem>
              <SelectItem value="sesion">sesion</SelectItem>
              <SelectItem value="otro">otro</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" variant="outline">{t.newCalItem}</Button>
        </form>
      </section>

      {/* Foro */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.forumTitle}</h2>
        <ul className="flex flex-col gap-2">
          {(threads ?? []).length === 0 ? <p className="text-sm text-muted-foreground">{t.forumEmpty}</p> : (threads ?? []).map((th) => (
            <li key={th.id}>
              <Card className="flex-row items-center gap-2 p-3">
                <Link href={`/admin/cursos/${courseId}/comunicacion/foro/${th.id}`} className="flex-1 font-medium underline underline-offset-4">{th.title}</Link>
                {th.resolved ? <Badge variant="success">{t.resolved}</Badge> : null}
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <Link href={`/admin/cursos/${courseId}/lecciones`} className="text-sm underline underline-offset-4">← {esCL.lessons.title}</Link>
    </main>
  );
}
