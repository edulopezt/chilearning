import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listCompanies } from "@/modules/portal-empresa/company-service";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { CreateCompanyForm, InviteForm } from "./invite-form";
import { RevokeMemberForm } from "./revoke-member-form";

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
      <PageHeader title={t.title} description={t.intro} />

      <CreateCompanyForm />
      <InviteForm companies={companies.map((c) => ({ id: c.id, razonSocial: c.razonSocial, rut: c.rut }))} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.listHeading}</h2>
        {companies.length === 0 ? (
          <EmptyState title={t.empty} />
        ) : (
          <ul className="flex flex-col gap-3">
            {companies.map((c) => (
              <li key={c.id}>
                <Card className="gap-3 p-4">
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
                    <ul className="flex flex-col gap-2 border-t pt-3">
                      {c.members.map((m) => (
                        <li key={m.id} className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:gap-3">
                          <span className="flex-1 break-all">{m.email}</span>
                          {m.revokedAt === null ? (
                            <div className="flex items-center gap-2">
                              <Badge variant="success">{t.memberActive}</Badge>
                              <RevokeMemberForm memberId={m.id} />
                            </div>
                          ) : (
                            <Badge variant="destructive">{t.revoked}</Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
