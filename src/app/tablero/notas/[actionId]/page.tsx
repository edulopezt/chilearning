import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { getGradebook, getGradeHistory } from "@/modules/evaluacion/gradebook-service";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { GradebookTable } from "./gradebook-table";

export const dynamic = "force-dynamic";

const t = esCL.gradebook;

function formatSantiago(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** Libro de notas de una acción (task 2.3, HU-6.4 — el GATE del hito). */
export default async function NotasAccionPage({
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
  const view = await getGradebook(principal, actionId);
  if (!view) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.forbidden}</p>
      </main>
    );
  }

  // El historial de cambios (auditoría) solo para el administrador del OTEC.
  const isAdmin = authorize(principal, principal.tenantId, ["otec_admin"]);
  const history = isAdmin ? await getGradeHistory(principal, actionId) : [];
  const anyIncomplete = view.gradebook.rows.some((r) => r.incomplete);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t.boardTitle}</h1>
          <p className="text-sm text-muted-foreground">
            {view.courseName} · <span className="font-mono">{view.code}</span>
          </p>
        </div>
        <span className="flex-1" />
        <a href={`/api/reportes/notas/${actionId}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          {t.downloadCsv}
        </a>
      </header>

      <GradebookTable gradebook={view.gradebook} />
      {anyIncomplete ? <p className="text-xs text-muted-foreground">{t.incompleteHint}</p> : null}

      {isAdmin ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t.historyTitle}</h2>
          <p className="text-xs text-muted-foreground">{t.historyIntro}</p>
          {history.length === 0 ? (
            <EmptyState title={t.historyEmpty} />
          ) : (
            <ul className="flex flex-col gap-2">
              {history.map((h, idx) => (
                <li key={`${h.gradeId}-${idx}`}>
                  <Card className="p-3 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-medium">{h.studentName}</span>
                      <span className="text-muted-foreground">{h.instrument}</span>
                      <span className="tabular-nums">
                        {h.oldGrade?.toFixed(1) ?? "—"} → <strong>{h.newGrade?.toFixed(1) ?? "—"}</strong>
                      </span>
                      <span className="flex-1" />
                      <span className="text-xs text-muted-foreground">{formatSantiago(h.at)}</span>
                    </div>
                    <p className="mt-1">
                      <span className="text-muted-foreground">{t.histMotivo}: </span>
                      {h.motivo || "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.histActor}: {h.actor}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <p>
        <Link href="/tablero/notas" className="text-sm underline underline-offset-4">
          ← {t.backToActions}
        </Link>
      </p>
    </main>
  );
}
