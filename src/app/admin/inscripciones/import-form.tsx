"use client";

import { useActionState, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
          <Select
            name="actionId"
            required
            value={selectedId}
            onValueChange={(value) => setSelectedId(value as string)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {actions.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t.fileLabel}
          <input
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="text-sm file:mr-2 file:inline-flex file:h-9 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:text-sm file:font-medium file:text-secondary-foreground"
          />
          <span className="text-muted-foreground text-xs">{t.templateHint}</span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={pending}>
            {t.submit}
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            render={<a href={templateHref(selected?.codSence ?? null)} download="plantilla-alumnos.csv" />}
          >
            {t.downloadTemplate}
          </Button>
        </div>
      </form>

      {state.status === "error" ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{ERROR_TEXT[state.error] ?? t.forbidden}</AlertDescription>
        </Alert>
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

  const summaryVariant = failed.length > 0 ? "destructive" : report.errors.length > 0 ? "warning" : "success";

  return (
    <section aria-live="polite" className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="font-semibold">{t.resultTitle}</h2>
      <Alert variant={summaryVariant} role={summaryVariant === "destructive" ? "alert" : "status"}>
        <AlertDescription>
          <strong>{imported}</strong> {t.imported}
          {" · "}
          <strong>{report.errors.length}</strong> {t.rejected}
          {failed.length > 0 ? (
            <>
              {" · "}
              <strong>{failed.length}</strong> {t.failed}
            </>
          ) : null}
        </AlertDescription>
      </Alert>
      {groupParts.length > 0 ? (
        <p className="text-muted-foreground text-sm">
          {t.groupsLabel} {groupParts.join(" · ")}
        </p>
      ) : null}
      {emails.sent + emails.failed + emails.skipped > 0 ? (
        <Alert variant={emails.failed > 0 ? "destructive" : "success"} role={emails.failed > 0 ? "alert" : "status"}>
          <AlertDescription>
            <strong>{emails.sent}</strong> {t.emailsSent}
            {emails.failed > 0 ? (
              <>
                {" · "}
                <strong>{emails.failed}</strong> {t.emailsFailed}
              </>
            ) : null}
            {emails.skipped > 0 ? (
              <>
                {" · "}
                <strong>{emails.skipped}</strong> {t.emailsSkipped}
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {rows.length === 0 ? (
        <Alert variant="success" role="status">
          <AlertDescription>{t.allGood}</AlertDescription>
        </Alert>
      ) : (
        <Table className="min-w-[24rem]">
          <TableHeader>
            <TableRow>
              <TableHead>{t.rowColumn}</TableHead>
              <TableHead>{t.fieldColumn}</TableHead>
              <TableHead>{t.messageColumn}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={`${r.row}-${r.field}-${i}`} className="align-top">
                <TableCell className="font-mono">{r.row}</TableCell>
                <TableCell>{r.field}</TableCell>
                <TableCell>{r.message}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
