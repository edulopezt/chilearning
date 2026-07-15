import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listGradebookActions } from "@/modules/evaluacion/gradebook-service";

export const dynamic = "force-dynamic";

const t = esCL.gradebook;

/** Índice de acciones para elegir su libro de notas (task 2.3, HU-6.4). */
export default async function NotasPage() {
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

  const actions = await listGradebookActions(principal);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      {actions.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.selectAction}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {actions.map((a) => (
            <li key={a.actionId}>
              <Link
                href={`/tablero/notas/${a.actionId}`}
                className="flex min-h-11 items-center gap-3 rounded-md border p-3 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                <span className="font-medium">{a.courseName}</span>
                <span className="text-muted-foreground font-mono text-sm">{a.code}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
