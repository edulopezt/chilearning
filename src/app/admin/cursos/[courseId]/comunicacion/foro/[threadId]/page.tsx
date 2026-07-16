import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getThread } from "@/modules/comunicacion/forum-service";
import { resolveThreadAction, staffReplyAction } from "../../actions";

export const dynamic = "force-dynamic";

const t = esCL.communication;

/** Hilo del foro para el staff: responder + marcar resuelta (task 3.4, HU-9.2). */
export default async function StaffForoThreadPage({ params }: { params: Promise<{ courseId: string; threadId: string }> }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  const { courseId, threadId } = await params;
  const view = await getThread(principal, threadId);
  if (!view) redirect(`/admin/cursos/${courseId}/comunicacion`);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-xl font-bold">{view.thread.title}</h1>
        <form action={resolveThreadAction}>
          <input type="hidden" name="courseId" value={courseId} />
          <input type="hidden" name="threadId" value={threadId} />
          <input type="hidden" name="resolved" value={view.thread.resolved ? "false" : "true"} />
          <button type="submit" className="min-h-11 rounded-md border px-3 text-sm">{view.thread.resolved ? t.reopen : t.markResolved}</button>
        </form>
      </header>

      <ul className="flex flex-col gap-3">
        {view.posts.map((p) => (
          <li key={p.id} className={`rounded-lg border p-3 ${p.fromStaff ? "bg-blue-50 dark:bg-blue-950" : ""}`}>
            <p className="mb-1 text-xs text-muted-foreground">{p.fromStaff ? t.staffBadge : ""} · {new Date(p.createdAt).toLocaleString("es-CL")}</p>
            <p className="whitespace-pre-wrap text-sm">{p.body}</p>
          </li>
        ))}
      </ul>

      <form action={staffReplyAction} className="flex flex-col gap-2 border-t pt-3">
        <input type="hidden" name="courseId" value={courseId} />
        <input type="hidden" name="threadId" value={threadId} />
        <textarea name="body" required rows={3} placeholder={t.postBodyLabel} className="input" />
        <button type="submit" className="min-h-11 self-start rounded-md bg-neutral-900 px-4 text-sm font-medium text-white dark:bg-white dark:text-neutral-900">{t.reply}</button>
      </form>

      <Link href={`/admin/cursos/${courseId}/comunicacion`} className="text-sm underline">← {t.forumTitle}</Link>
    </main>
  );
}
