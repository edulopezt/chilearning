import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { hasRole, isSuperadmin } from "@/modules/core/domain/rbac";
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

      <nav className="flex flex-wrap gap-3">
        {hasRole(principal, "student") ? (
          <Link
            href="/mi-curso"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-neutral-900 px-4 font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            {esCL.dashboard.goToCourse}
          </Link>
        ) : null}
        {hasRole(principal, "otec_admin") ? (
          <>
            <Link
              href="/admin/sence"
              className="inline-flex min-h-11 items-center justify-center rounded-md border px-4 font-medium"
            >
              {esCL.senceAdmin.title}
            </Link>
            <Link
              href="/admin/marca"
              className="inline-flex min-h-11 items-center justify-center rounded-md border px-4 font-medium"
            >
              {esCL.branding.title}
            </Link>
          </>
        ) : null}
        {hasRole(principal, "otec_admin") ||
        hasRole(principal, "coordinator") ||
        hasRole(principal, "instructor") ||
        hasRole(principal, "tutor") ? (
          <Link
            href="/tablero"
            className="inline-flex min-h-11 items-center justify-center rounded-md border px-4 font-medium"
          >
            {esCL.board.title}
          </Link>
        ) : null}
        {hasRole(principal, "otec_admin") || hasRole(principal, "coordinator") ? (
          <>
            <Link
              href="/admin/cursos"
              className="inline-flex min-h-11 items-center justify-center rounded-md border px-4 font-medium"
            >
              {esCL.courses.title}
            </Link>
            <Link
              href="/admin/acciones"
              className="inline-flex min-h-11 items-center justify-center rounded-md border px-4 font-medium"
            >
              {esCL.actions.title}
            </Link>
            <Link
              href="/admin/inscripciones"
              className="inline-flex min-h-11 items-center justify-center rounded-md border px-4 font-medium"
            >
              {esCL.enrollmentImport.title}
            </Link>
          </>
        ) : null}
      </nav>
    </main>
  );
}
