import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listDsrRequests } from "@/modules/core/privacy-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldControl, FieldRoot } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ApplyErasureButton } from "./apply-erasure-button";
import { resolveDsrAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.dsrAdmin;

/** Consola de solicitudes de derechos (task 3.5, HU-2.4). Admin/coordinador. */
export default async function DerechosPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator"])) {
    return <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6"><p className="text-muted-foreground">{t.forbidden}</p></main>;
  }
  const requests = await listDsrRequests(principal);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader title={t.title} />
      {requests.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((r) => (
            <li key={r.id}>
              <Card className="gap-2 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{r.kind}</span>
                  <Badge variant="secondary">{r.status}</Badge>
                  <span className="ml-auto text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString("es-CL")}</span>
                </div>
                {r.detail ? <p className="text-sm text-muted-foreground">{r.detail}</p> : null}
                {r.resolutionNote ? <p className="rounded bg-muted p-2 text-xs">{r.resolutionNote}</p> : null}
                {r.status === "pending" || r.status === "processing" ? (
                  <div className="flex flex-wrap items-end gap-2 border-t pt-2">
                    {r.kind === "erasure" ? (
                      <ApplyErasureButton requestId={r.id} />
                    ) : (
                      <form action={resolveDsrAction} className="flex flex-1 items-end gap-2">
                        <input type="hidden" name="requestId" value={r.id} />
                        <input type="hidden" name="status" value="completed" />
                        <FieldRoot className="flex-1">
                          <FieldControl name="note" placeholder={t.noteLabel} aria-label={t.noteLabel} />
                        </FieldRoot>
                        <Button type="submit" variant="outline">{t.resolve}</Button>
                      </form>
                    )}
                    <form action={resolveDsrAction}>
                      <input type="hidden" name="requestId" value={r.id} />
                      <input type="hidden" name="status" value="rejected" />
                      <input type="hidden" name="note" value="Rechazada" />
                      <Button type="submit" variant="outline">{t.reject}</Button>
                    </form>
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
