import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { isSuperadmin } from "@/modules/core/domain/rbac";
import { SignOutButton } from "./sign-out-button";

/**
 * Página protegida mínima (HU-2.1/2.3): si no hay sesión, el middleware ya
 * redirige a /login. Aquí se muestra el Principal derivado de los claims del
 * Auth Hook, probando que el circuito login → claims → RBAC funciona.
 */
export default async function DashboardPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">{esCL.dashboard.title}</h1>
        <SignOutButton />
      </header>

      <p className="text-green-700 dark:text-green-400">{esCL.dashboard.welcome}</p>

      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">{esCL.dashboard.yourTenant}</dt>
          <dd className="font-mono">
            {isSuperadmin(principal)
              ? esCL.dashboard.platformAdmin
              : (principal.tenantId ?? "—")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{esCL.dashboard.yourRoles}</dt>
          <dd className="font-medium">{principal.roles.join(", ") || "—"}</dd>
        </div>
      </dl>
    </main>
  );
}
