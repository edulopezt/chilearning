import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { getThread } from "@/modules/comunicacion/message-service";
import { aiClientFromEnv } from "@/modules/tutor-ia/ai-client";
import { AiDraftButton } from "@/components/ai-draft-button";
import { generateMessageDraftAction, staffSendMessageAction } from "../actions";

export const dynamic = "force-dynamic";

const t = esCL.communication;

/** Hilo de mensajería para el staff (task 3.4, HU-9.3). */
export default async function StaffMessageThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator", "instructor", "tutor"])) {
    return <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6"><p className="text-muted-foreground">{t.forbidden}</p></main>;
  }
  const { threadId } = await params;
  const view = await getThread(principal, threadId);
  if (!view) redirect("/admin/mensajes");
  const aiConfigured = aiClientFromEnv(process.env).configured;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-xl font-bold">{view.thread.subject}</h1>
      <ul className="flex flex-col gap-3">
        {view.messages.map((m) => (
          <li key={m.id} className={`rounded-lg border p-3 ${m.senderIsStaff ? "bg-blue-50 dark:bg-blue-950" : ""}`}>
            <p className="mb-1 text-xs text-muted-foreground">{m.senderIsStaff ? t.staffBadge : ""} · {new Date(m.createdAt).toLocaleString("es-CL")}</p>
            <p className="whitespace-pre-wrap text-sm">{m.body}</p>
          </li>
        ))}
      </ul>
      <form action={staffSendMessageAction} className="flex flex-col gap-2 border-t pt-3">
        <input type="hidden" name="threadId" value={threadId} />
        {aiConfigured ? (
          <AiDraftButton threadId={threadId} generateDraft={generateMessageDraftAction} placeholder={t.postBodyLabel} />
        ) : (
          <textarea name="body" required rows={3} placeholder={t.postBodyLabel} className="input" />
        )}
        <button type="submit" className="min-h-11 self-start rounded-md bg-neutral-900 px-4 text-sm font-medium text-white dark:bg-white dark:text-neutral-900">{t.reply}</button>
      </form>
      <Link href="/admin/mensajes" className="text-sm underline">← {t.inboxTitle}</Link>
    </main>
  );
}
