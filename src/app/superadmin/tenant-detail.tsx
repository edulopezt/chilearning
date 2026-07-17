"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import { viewTenantDetailAction, type TenantDetailState } from "./actions";

const t = esCL.superadmin.board;

/**
 * Detalle de soporte por OTEC ("use client": necesita el estado del resultado de
 * la action). El detalle SOLO se pinta con lo que devuelve la action, que ya
 * auditó el acceso — no hay camino para verlo sin traza.
 */
export function TenantSupportDetail({ tenantId }: Readonly<{ tenantId: string }>) {
  const [state, formAction, pending] = useActionState<TenantDetailState, FormData>(
    viewTenantDetailAction,
    {},
  );

  return (
    <div className="flex flex-col gap-2">
      {!state.detail && (
        <form action={formAction}>
          <input type="hidden" name="tenantId" value={tenantId} />
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-md border px-3 text-xs disabled:opacity-50"
          >
            {t.supportView}
          </button>
        </form>
      )}

      {state.error === "audit_failed" && (
        <p className="text-xs text-red-600 dark:text-red-400">{t.supportFailed}</p>
      )}

      {state.detail && (
        <div className="flex flex-col gap-1 text-xs">
          <p className="text-muted-foreground">{t.supportNotice}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">{esCL.superadmin.board.colStudents}</dt>
              <dd className="font-medium tabular-nums">{state.detail.students}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t.detailCourses}</dt>
              <dd className="font-medium tabular-nums">{state.detail.courses}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t.detailActions}</dt>
              <dd className="font-medium tabular-nums">{state.detail.actions}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t.detailCertificates}</dt>
              <dd className="font-medium tabular-nums">{state.detail.certificates}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
