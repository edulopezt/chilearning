import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getThread } from "@/modules/comunicacion/forum-service";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldControl, FieldRoot } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { addPostAction } from "../../actions";

export const dynamic = "force-dynamic";

const t = esCL.communication;

/** Hilo del foro para el alumno (task 3.4, HU-9.2). */
export default async function StudentForoThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  const { threadId } = await params;
  const view = await getThread(principal, threadId);
  if (!view) redirect("/mi-curso/comunicacion");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-xl font-bold">
        {view.thread.title}
        {view.thread.resolved ? ` · ${t.resolved}` : ""}
      </h1>
      <ul className="flex flex-col gap-3">
        {view.posts.map((p) => (
          <li key={p.id}>
            <Card className={cn("gap-1 p-3", p.fromStaff && "bg-accent")}>
              <p className="mb-1 text-xs text-muted-foreground">
                {p.fromStaff ? t.staffBadge : ""} · {new Date(p.createdAt).toLocaleString("es-CL")}
              </p>
              <p className="text-sm whitespace-pre-wrap">{p.body}</p>
            </Card>
          </li>
        ))}
      </ul>
      <form action={addPostAction} className="flex flex-col gap-3 border-t pt-3">
        <input type="hidden" name="threadId" value={threadId} />
        <FieldRoot>
          <FieldControl render={<Textarea name="body" required rows={3} placeholder={t.postBodyLabel} />} />
        </FieldRoot>
        <Button type="submit" className="self-start">
          {t.send}
        </Button>
      </form>
      <Link href="/mi-curso/comunicacion" className="text-sm underline underline-offset-4">
        ← {t.forumTitle}
      </Link>
    </main>
  );
}
