import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listCompanies } from "@/modules/portal-empresa/company-service";
import { CreateCompanyForm, InviteForm } from "./invite-form";
import { revokeCompanyMemberAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.companies;

/** Gestión de empresas cliente (task 5.2, HU-8.1). Staff: admin/coordinador. */
export default async function EmpresasPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator"])) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.forbidden}</p>
      </main>
    );
  }

  const companies = (await listCompanies(principal)) ?? [];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      <CreateCompanyForm />
      <InviteForm companies={companies.map((c) => ({ id: c.id, razonSocial: c.razonSocial, rut: c.rut }))} />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.listHeading}</h2>
        {companies.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.empty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {companies.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
                <div className="flex flex-col gap-0.5">
                  <p className="font-medium break-words">{c.razonSocial}</p>
                  <p className="text-muted-foreground text-xs">
                    <span className="font-mono">{c.rut}</span>
                    {" · "}
                    {c.activeMembers} {t.members}
                    {" · "}
                    {c.enrollments} {t.workers}
                  </p>
                </div>

                {c.members.length > 0 ? (
                  <ul className="flex flex-col gap-1 border-t pt-2">
                    {c.members.map((m) => (
                      <li key={m.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                        <span className="flex-1 break-all">{m.email}</span>
                        {m.revokedAt === null ? (
                          <>
                            <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900 dark:text-green-200">
                              {t.memberActive}
                            </span>
                            <form action={revokeCompanyMemberAction}>
                              <input type="hidden" name="memberId" value={m.id} />
                              <button type="submit" className="min-h-11 rounded-md border px-3 text-xs text-red-600">
                                {t.revoke}
                              </button>
                            </form>
                          </>
                        ) : (
                          <span className="rounded bg-neutral-200 px-2 py-0.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                            {t.revoked}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
