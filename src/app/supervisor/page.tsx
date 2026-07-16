import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listSupervisorActions } from "@/modules/portal-empresa/supervisor-portal-service";

export const dynamic = "force-dynamic";

const t = esCL.supervisorPortal;

/**
 * Portal del fiscalizador (task 2.5, HU-5.5 CA + M12 v1): índice de acciones,
 * SOLO LECTURA estructural — estas rutas no montan formularios ni Server
 * Actions. Admin/coordinador también entran (demostración al fiscalizador).
 * Invitaciones/alcance/vigencia = Hito 3 (3.11).
 */
export default async function SupervisorPortalPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["supervisor"])) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.forbidden}</p>
      </main>
    );
  }

  // Portal GATED (3.11): sin grant vigente/en alcance → lista vacía + auditoría.
  const actions = await listSupervisorActions(principal);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      {actions.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {actions.map((a) => (
            <li key={a.actionId}>
              <Link
                href={`/supervisor/acciones/${a.actionId}`}
                className="flex min-h-11 flex-col gap-1 rounded-md border p-3 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                <span className="font-medium">{a.courseName}</span>
                <span className="text-muted-foreground text-sm">
                  <span className="font-mono">{a.codigoAccion}</span>
                  {" · "}
                  {a.enrolled} {t.enrolled}
                  {" · "}
                  {a.startsOn ?? "—"} → {a.endsOn ?? "—"}
                  {" · "}
                  {a.environment === "rce" ? esCL.actions.envProd : esCL.actions.envTest}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
