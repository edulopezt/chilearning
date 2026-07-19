import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { tenantGuard } from "@/lib/tenant-guard";
import { PROCESSING_ACTIVITIES, RETENTION_POLICIES } from "@/modules/core/domain/privacy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { FieldControl, FieldLabel, FieldRoot } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { requestDsrAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.dataRights;
const p = esCL.privacy;

/** Portal del titular: export, solicitudes y transparencia (task 3.5, HU-2.4). */
export default async function MisDatosPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  // Solicitudes propias (RLS limita a las del usuario).
  const guard = tenantGuard(principal.tenantId ?? "00000000-0000-4000-8000-000000000000");
  const { data: requests } = principal.tenantId
    ? await guard.db.from("dsr_requests").select("id, kind, status, created_at").eq("tenant_id", principal.tenantId).eq("user_id", principal.userId).order("created_at", { ascending: false })
    : { data: [] };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <PageHeader title={t.title} description={t.intro} />

      <section className="flex flex-col gap-3">
        <a href="/api/mis-datos/export" className={cn(buttonVariants(), "w-fit")}>
          {t.exportButton}
        </a>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.requestTitle}</h2>
        <p className="text-xs text-muted-foreground">{t.retentionNote}</p>
        <form action={requestDsrAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <FieldRoot>
            <FieldLabel>{t.kindLabel}</FieldLabel>
            <Select name="kind" defaultValue="access">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="access">{t.kindAccess}</SelectItem>
                <SelectItem value="rectification">{t.kindRectification}</SelectItem>
                <SelectItem value="erasure">{t.kindErasure}</SelectItem>
                <SelectItem value="portability">{t.kindPortability}</SelectItem>
              </SelectContent>
            </Select>
          </FieldRoot>
          <FieldRoot className="flex-1">
            <FieldControl name="detail" placeholder={t.detailLabel} />
          </FieldRoot>
          <Button type="submit" variant="outline">
            {t.submit}
          </Button>
        </form>
        <div>
          <h3 className="text-sm font-medium">{t.myRequests}</h3>
          {((requests ?? []) as { id: string; kind: string; status: string; created_at: string }[]).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.empty}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {((requests ?? []) as { id: string; kind: string; status: string; created_at: string }[]).map((r) => (
                <li key={r.id} className="flex gap-3 rounded-md border p-2">
                  <span className="font-medium">{r.kind}</span>
                  <span className="text-muted-foreground">{r.status}</span>
                  <span className="ml-auto text-muted-foreground">{new Date(r.created_at).toLocaleDateString("es-CL")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{p.retentionTitle}</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {RETENTION_POLICIES.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              <span className="flex-1 font-medium">{r.dataType}</span>
              <span className="text-muted-foreground">{r.periodLabel}</span>
              <Badge variant={r.retained ? "warning" : "success"}>
                {r.retained ? p.retainedBadge : p.erasableBadge}
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{p.processingTitle}</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {PROCESSING_ACTIVITIES.map((a, i) => (
            <li key={i} className="rounded-md border p-2">
              <span className="font-medium">{a.purpose}</span>
              <span className="block text-xs text-muted-foreground">
                {a.dataCategories} · {a.basis}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Link href="/mi-curso" className="text-sm underline underline-offset-4">
        ← {t.backToCourse}
      </Link>
    </main>
  );
}
