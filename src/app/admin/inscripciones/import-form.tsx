"use client";

import { useActionState, useState } from "react";

import { esCL } from "@/i18n/es-CL";
import { BECARIO_LABEL } from "@/modules/academico/domain/enrollment-group";
import { importEnrollmentsAction, type ImportActionState } from "./actions";

const t = esCL.enrollmentImport;

const ERROR_TEXT: Record<string, string> = {
  forbidden: t.forbidden,
  no_tenant: t.forbidden,
  action_not_found: t.forbidden,
  no_file: t.errorNoFile,
  no_action: t.errorNoAction,
};

interface ActionOption {
  id: string;
  label: string;
  codSence: string | null;
}

/**
 * Plantilla generada POR ACCIÓN (H4 4-ojos): con curso SENCE lleva el grupo
 * con el código REAL del curso destino (importa limpia tal cual); sin código
 * SENCE, la variante clásica con `exento` (el grupo Sence-… no aplica ahí).
 */
function templateCsv(codSence: string | null): string {
  if (codSence) {
    return (
      "nombre,apellidos,email,run,grupo\n" +
      `Ana,Díaz Rojas,ana@ejemplo.cl,16032460-0,Sence-${codSence}\n` +
      `Juan,Soto Pinto,juan@ejemplo.cl,9876543-3,${BECARIO_LABEL}\n`
    );
  }
  return (
    "nombre,apellidos,email,run,exento\n" +
    "Ana,Díaz Rojas,ana@ejemplo.cl,16032460-0,No\n" +
    "Juan,Soto Pinto,juan@ejemplo.cl,9876543-3,Sí\n"
  );
}

function templateHref(codSence: string | null): string {
  return `data:text/csv;charset=utf-8,${encodeURIComponent(templateCsv(codSence))}`;
}

export function ImportForm({
  actions,
  initialActionId,
}: {
  actions: ActionOption[];
  /**
   * Acción preseleccionada (task 5.12): es lo que hace real el "enlace directo a
   * re-inscripción" del listado de vencimientos. Si el id no existe en el tenant
   * se ignora y cae al default (no se confía en el searchParam).
   */
  initialActionId?: string;
}) {
  const [state, formAction, pending] = useActionState<ImportActionState, FormData>(
    importEnrollmentsAction,
    { status: "idle" },
  );
  // Acción seleccionada: la plantilla descargable se genera con SU código SENCE.
  const [selectedId, setSelectedId] = useState(
    (initialActionId && actions.some((a) => a.id === initialActionId) ? initialActionId : actions[0]?.id) ?? "",
  );
  const selected = actions.find((a) => a.id === selectedId) ?? actions[0];

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-5">
        <label className="flex flex-col gap-1 text-sm">
          {t.actionLabel}
          <select
            name="actionId"
            required
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="min-h-11 rounded-md border px-3 text-base"
          >
            {actions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t.fileLabel}
          <input
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="rounded-md border p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-neutral-200 file:px-3 file:py-2 dark:file:bg-neutral-700"
          />
          <span className="text-muted-foreground text-xs">{t.templateHint}</span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-md bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
          >
            {t.submit}
          </button>
          <a
            href={templateHref(selected?.codSence ?? null)}
            download="plantilla-alumnos.csv"
            className="text-sm underline"
          >
            {t.downloadTemplate}
          </a>
        </div>
      </form>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-red-600">
          {ERROR_TEXT[state.error] ?? t.forbidden}
        </p>
      ) : null}

      {state.status === "done" ? <ImportResult outcome={state.outcome} /> : null}
    </div>
  );
}

function ImportResult({ outcome }: { outcome: Extract<ImportActionState, { status: "done" }>["outcome"] }) {
  const { imported, failed, report, emails, groups } = outcome;
  const rows = [
    ...report.errors.map((e) => ({ row: e.rowNumber, field: e.field, message: e.message })),
    ...failed.map((f) => ({ row: f.rowNumber, field: "—", message: f.reason })),
  ].sort((a, b) => a.row - b.row);

  // Desglose por grupo operativo (HU-2.2): "Sence-<código>" y "Becario" son
  // códigos del OTEC (datos, no textos traducibles). Curso sin código SENCE:
  // los no exentos se cuentan como "sin grupo" (no se omiten del desglose).
  const groupParts = [
    ...(groups.sence > 0
      ? [`${groups.sence} × ${groups.senceLabel ?? t.noGroup}`]
      : []),
    ...(groups.becario > 0 ? [`${groups.becario} × ${BECARIO_LABEL}`] : []),
  ];

  return (
    <section aria-live="polite" className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="font-semibold">{t.resultTitle}</h2>
      <p className="text-sm">
        <strong className="text-green-700 dark:text-green-400">{imported}</strong> {t.imported}
        {" · "}
        <strong>{report.errors.length}</strong> {t.rejected}
        {failed.length > 0 ? (
          <>
            {" · "}
            <strong className="text-red-600">{failed.length}</strong> {t.failed}
          </>
        ) : null}
      </p>
      {groupParts.length > 0 ? (
        <p className="text-muted-foreground text-sm">
          {t.groupsLabel} {groupParts.join(" · ")}
        </p>
      ) : null}
      {emails.sent + emails.failed + emails.skipped > 0 ? (
        <p className="text-sm">
          <strong className="text-green-700 dark:text-green-400">{emails.sent}</strong>{" "}
          {t.emailsSent}
          {emails.failed > 0 ? (
            <>
              {" · "}
              <strong className="text-red-600">{emails.failed}</strong> {t.emailsFailed}
            </>
          ) : null}
          {emails.skipped > 0 ? (
            <>
              {" · "}
              <strong>{emails.skipped}</strong> {t.emailsSkipped}
            </>
          ) : null}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-green-700 dark:text-green-400">{t.allGood}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[24rem] border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-3">{t.rowColumn}</th>
                <th className="py-2 pr-3">{t.fieldColumn}</th>
                <th className="py-2">{t.messageColumn}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.row}-${r.field}-${i}`} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-3 font-mono">{r.row}</td>
                  <td className="py-2 pr-3">{r.field}</td>
                  <td className="py-2">{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
