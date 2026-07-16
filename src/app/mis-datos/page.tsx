import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { tenantGuard } from "@/lib/tenant-guard";
import { PROCESSING_ACTIVITIES, RETENTION_POLICIES } from "@/modules/core/domain/privacy";
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
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      <section className="flex flex-col gap-3">
        <a href="/api/mis-datos/export" className="inline-flex min-h-11 w-fit items-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white dark:bg-white dark:text-neutral-900">
          {t.exportButton}
        </a>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.requestTitle}</h2>
        <p className="text-muted-foreground text-xs">{t.retentionNote}</p>
        <form action={requestDsrAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1 text-sm">
            {t.kindLabel}
            <select name="kind" className="input">
              <option value="access">{t.kindAccess}</option>
              <option value="rectification">{t.kindRectification}</option>
              <option value="erasure">{t.kindErasure}</option>
              <option value="portability">{t.kindPortability}</option>
            </select>
          </label>
          <input name="detail" placeholder={t.detailLabel} className="input flex-1" />
          <button type="submit" className="min-h-11 rounded-md border px-4 text-sm font-medium">{t.submit}</button>
        </form>
        <div>
          <h3 className="text-sm font-medium">{t.myRequests}</h3>
          {((requests ?? []) as { id: string; kind: string; status: string; created_at: string }[]).length === 0 ? (
            <p className="text-muted-foreground text-sm">{t.empty}</p>
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
              <span className={`rounded px-2 py-0.5 text-xs ${r.retained ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"}`}>
                {r.retained ? p.retainedBadge : p.erasableBadge}
              </span>
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
              <span className="block text-xs text-muted-foreground">{a.dataCategories} · {a.basis}</span>
            </li>
          ))}
        </ul>
      </section>

      <Link href="/mi-curso" className="text-sm underline">← {t.backToCourse}</Link>
    </main>
  );
}
