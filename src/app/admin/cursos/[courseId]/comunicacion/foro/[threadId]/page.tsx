import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { getThread } from "@/modules/comunicacion/forum-service";
import { aiClientFromEnv } from "@/modules/tutor-ia/ai-client";
import { AiDraftButton } from "@/components/ai-draft-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldControl, FieldRoot } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { generateForumDraftAction, resolveThreadAction, staffReplyAction } from "../../actions";

export const dynamic = "force-dynamic";

const t = esCL.communication;

/** Hilo del foro para el staff: responder + marcar resuelta (task 3.4, HU-9.2). */
export default async function StaffForoThreadPage({ params }: { params: Promise<{ courseId: string; threadId: string }> }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator", "instructor", "tutor"])) {
    return <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6"><p className="text-muted-foreground">{t.forbidden}</p></main>;
  }
  const { courseId, threadId } = await params;
  const view = await getThread(principal, threadId);
  if (!view) redirect(`/admin/cursos/${courseId}/comunicacion`);
  const aiConfigured = aiClientFromEnv(process.env).configured;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title={view.thread.title}
        actions={
          <form action={resolveThreadAction}>
            <input type="hidden" name="courseId" value={courseId} />
            <input type="hidden" name="threadId" value={threadId} />
            <input type="hidden" name="resolved" value={view.thread.resolved ? "false" : "true"} />
            <Button type="submit" variant="outline" size="sm">{view.thread.resolved ? t.reopen : t.markResolved}</Button>
          </form>
        }
      />

      <ul className="flex flex-col gap-3">
        {view.posts.map((p) => (
          <li key={p.id}>
            <Card className={cn("p-3", p.fromStaff && "bg-accent/40")}>
              <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                {p.fromStaff ? <Badge variant="outline">{t.staffBadge}</Badge> : null} · {new Date(p.createdAt).toLocaleString("es-CL")}
              </p>
              <p className="text-sm whitespace-pre-wrap">{p.body}</p>
            </Card>
          </li>
        ))}
      </ul>

      <form action={staffReplyAction} className="flex flex-col gap-2 border-t pt-3">
        <input type="hidden" name="courseId" value={courseId} />
        <input type="hidden" name="threadId" value={threadId} />
        {aiConfigured ? (
          <AiDraftButton threadId={threadId} generateDraft={generateForumDraftAction} placeholder={t.postBodyLabel} />
        ) : (
          <FieldRoot>
            <FieldControl name="body" required placeholder={t.postBodyLabel} render={<Textarea rows={3} />} />
          </FieldRoot>
        )}
        <Button type="submit" className="self-start">{t.reply}</Button>
      </form>

      <Link href={`/admin/cursos/${courseId}/comunicacion`} className="text-sm underline underline-offset-4">← {t.forumTitle}</Link>
    </main>
  );
}
