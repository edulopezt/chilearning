import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { getExpediente } from "@/modules/reportes/expediente-service";
import { DOC_TYPE_LABEL } from "@/modules/reportes/domain/expediente";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { UploadForm } from "./upload-form";
import { markDefinitiveAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.expediente;

/** Expediente de fiscalización por acción (task 3.12, HU-5.10). Staff. */
export default async function ExpedientePage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator"])) {
    return <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6"><p className="text-muted-foreground">{t.forbidden}</p></main>;
  }
  const { id: actionId } = await params;
  const view = await getExpediente(principal, actionId);
  if (!view) redirect("/admin/acciones");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader title={t.title} description={t.intro} />

      {/* Checklist de completitud */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-lg font-semibold">{t.checklist}</h2>
          <Badge variant={view.completeness.complete ? "success" : "warning"}>
            {view.completeness.complete ? t.complete : `${t.incomplete} (${view.completeness.done}/${view.completeness.total})`}
          </Badge>
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {view.checklist.map((c) => (
            <li key={c.docType}>
              <Card className="flex-row items-center gap-2 p-2">
                <span className="flex-1">{DOC_TYPE_LABEL[c.docType]}</span>
                <span className={c.present ? "text-success" : "text-destructive"}>
                  {c.present ? `✓ ${t.present} (${c.count})` : `✕ ${t.missing}`}
                </span>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {/* Documentos */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-lg font-semibold">{t.documents}</h2>
          <Button variant="outline" render={<a href={`/api/reportes/expediente/${actionId}`} />}>
            {t.downloadZip}
          </Button>
        </div>
        {view.documents.length === 0 ? (
          <EmptyState title={t.empty} />
        ) : (
          <ul className="flex flex-col gap-2">
            {view.documents.map((d) => (
              <li key={d.id}>
                <Card className="flex-row flex-wrap items-center gap-2 p-3 text-sm">
                  <Badge variant="outline">{DOC_TYPE_LABEL[d.docType]}</Badge>
                  <span className="flex-1 font-medium">{d.title}</span>
                  {d.documentDate ? <span className="text-xs text-muted-foreground">{d.documentDate}</span> : null}
                  {d.isDefinitive ? (
                    <Badge>{t.definitiveBadge}</Badge>
                  ) : (
                    <form action={markDefinitiveAction}>
                      <input type="hidden" name="actionId" value={actionId} />
                      <input type="hidden" name="documentId" value={d.id} />
                      <Button type="submit" variant="ghost" size="xs">{t.markDefinitive}</Button>
                    </form>
                  )}
                </Card>
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
