import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { listDsrRequests } from "@/modules/core/privacy-service";
import { applyErasureAction, resolveDsrAction } from "./actions";

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
      <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
      {requests.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{r.kind}</span>
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">{r.status}</span>
                <span className="ml-auto text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString("es-CL")}</span>
              </div>
              {r.detail ? <p className="text-sm text-muted-foreground">{r.detail}</p> : null}
              {r.resolutionNote ? <p className="rounded bg-neutral-50 p-2 text-xs dark:bg-neutral-900">{r.resolutionNote}</p> : null}
              {r.status === "pending" || r.status === "processing" ? (
                <div className="flex flex-wrap items-end gap-2 border-t pt-2">
                  {r.kind === "erasure" ? (
                    <form action={applyErasureAction}>
                      <input type="hidden" name="requestId" value={r.id} />
                      <button type="submit" className="min-h-11 rounded-md bg-red-600 px-3 text-sm font-medium text-white">{t.applyErasure}</button>
                    </form>
                  ) : (
                    <form action={resolveDsrAction} className="flex flex-1 items-end gap-2">
                      <input type="hidden" name="requestId" value={r.id} />
                      <input type="hidden" name="status" value="completed" />
                      <input name="note" placeholder={t.noteLabel} className="input flex-1" />
                      <button type="submit" className="min-h-11 rounded-md border px-3 text-sm font-medium">{t.resolve}</button>
                    </form>
                  )}
                  <form action={resolveDsrAction}>
                    <input type="hidden" name="requestId" value={r.id} />
                    <input type="hidden" name="status" value="rejected" />
                    <input type="hidden" name="note" value="Rechazada" />
                    <button type="submit" className="min-h-11 rounded-md border px-3 text-sm">{t.reject}</button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
