import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { getExpediente } from "@/modules/reportes/expediente-service";
import { DOC_TYPE_LABEL } from "@/modules/reportes/domain/expediente";
import { UploadForm } from "./upload-form";
import { markDefinitiveAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.expediente;

/** Expediente de fiscalización por acción (task 3.12, HU-5.10). Staff. */
export default async function ExpedientePage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator", "instructor"])) {
    return <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6"><p className="text-muted-foreground">{t.forbidden}</p></main>;
  }
  const { id: actionId } = await params;
  const view = await getExpediente(principal, actionId);
  if (!view) redirect("/admin/acciones");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      {/* Checklist de completitud */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-lg font-semibold">{t.checklist}</h2>
          <span className={`rounded px-2 py-0.5 text-xs ${view.completeness.complete ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"}`}>
            {view.completeness.complete ? t.complete : `${t.incomplete} (${view.completeness.done}/${view.completeness.total})`}
          </span>
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {view.checklist.map((c) => (
            <li key={c.docType} className="flex items-center gap-2 rounded-md border p-2">
              <span className="flex-1">{DOC_TYPE_LABEL[c.docType]}</span>
              <span className={c.present ? "text-green-700 dark:text-green-400" : "text-red-600"}>
                {c.present ? `✓ ${t.present} (${c.count})` : `✕ ${t.missing}`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Documentos */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-lg font-semibold">{t.documents}</h2>
          <a href={`/api/reportes/expediente/${actionId}`} className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium">
            {t.downloadZip}
          </a>
        </div>
        {view.documents.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">{DOC_TYPE_LABEL[d.docType]}</span>
                <span className="flex-1 font-medium">{d.title}</span>
                {d.documentDate ? <span className="text-xs text-muted-foreground">{d.documentDate}</span> : null}
                {d.isDefinitive ? (
                  <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-900 dark:text-blue-200">{t.definitiveBadge}</span>
                ) : (
                  <form action={markDefinitiveAction}>
                    <input type="hidden" name="actionId" value={actionId} />
                    <input type="hidden" name="documentId" value={d.id} />
                    <button type="submit" className="min-h-11 text-xs underline">{t.markDefinitive}</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.upload}</h2>
        <UploadForm actionId={actionId} />
      </section>

      <Link href="/admin/acciones" className="text-sm underline">{t.backToActions}</Link>
    </main>
  );
}
