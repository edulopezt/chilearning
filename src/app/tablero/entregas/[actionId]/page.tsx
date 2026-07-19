import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listPendingSubmissions } from "@/modules/evaluacion/grading-service";
import { EmptyState } from "@/components/ui/empty-state";
import { GradeRow } from "./grade-row";

export const dynamic = "force-dynamic";

const t = esCL.grading;

/** Cola de corrección de una acción (task 2.2, HU-6.2). */
export default async function EntregasAccionPage({
  params,
}: {
  params: Promise<{ actionId: string }>;
}) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (
    !principal.tenantId ||
    !authorize(principal, principal.tenantId, ["otec_admin", "coordinator", "instructor", "tutor"])
  ) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.forbidden}</p>
      </main>
    );
  }

  const { actionId } = await params;
  // Solo el relator (y admin/coord) publica la nota final (matriz §3).
  const canPublish = authorize(principal, principal.tenantId, [
    "otec_admin",
    "coordinator",
    "instructor",
  ]);
  const pending = await listPendingSubmissions(principal, actionId);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.gradingTitle}</h1>
        <p className="text-sm text-muted-foreground">{t.intro}</p>
      </header>

      {pending.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        <ul className="flex flex-col gap-3">
          {pending.map((s) => (
            <GradeRow key={s.submissionId} submission={s} actionId={actionId} canPublish={canPublish} />
          ))}
        </ul>
      )}

      <p>
        <Link href="/tablero/entregas" className="text-sm underline underline-offset-4">
          ← {t.title}
        </Link>
      </p>
    </main>
  );
}
