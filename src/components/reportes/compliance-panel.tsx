import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button-variants";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { esCL } from "@/i18n/es-CL";
import { BECARIO_LABEL } from "@/modules/academico/domain/enrollment-group";
import type { CompliancePanel } from "@/modules/reportes/cumplimiento-service";
import type { DayCellStatus } from "@/modules/reportes/domain/cumplimiento";

const t = esCL.cumplimiento;

const CELL_STYLE: Record<DayCellStatus, { symbol: string; className: string; label: string }> = {
  cerrada: { symbol: "✓", className: "text-success", label: "cerrada" },
  iniciada: { symbol: "◐", className: "text-warning", label: "iniciada" },
  error: { symbol: "✕", className: "text-destructive", label: "error" },
  none: { symbol: "·", className: "text-muted-foreground", label: "none" },
  exento: { symbol: "—", className: "text-muted-foreground", label: "exento" },
};

/**
 * Panel de cumplimiento SENCE (task 2.4, HU-5.5) — presentacional compartido:
 * lo renderizan /admin/acciones/[id]/cumplimiento y el portal del fiscalizador
 * (2.5, "ve este MISMO panel"). Sin mutaciones: solo lectura estructural.
 * En <sm colapsa a tarjetas por alumno (RNF-6).
 */
export function CompliancePanelView({
  panel,
  exportBasePath,
}: {
  panel: CompliancePanel;
  exportBasePath: string;
}) {
  const dayLabels = panel.days.map((d) => d.slice(5)); // MM-DD
  // Grupo operativo del OTEC (HU-2.2): "Becario" o "Sence-<código del curso>";
  // null si el curso no tiene código (la celda muestra "—"; en móvil se omite).
  const groupOf = (exento: boolean): string | null =>
    exento ? BECARIO_LABEL : panel.senceGroupLabel;
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{t.matrixTitle}</h2>
          <span className="flex-1" />
          <a
            href={`${exportBasePath}?formato=xlsx`}
            className={cn(buttonVariants({ variant: "outline", size: "default" }))}
          >
            {t.downloadXlsx}
          </a>
          <a
            href={`${exportBasePath}?formato=csv`}
            className={cn(buttonVariants({ variant: "outline", size: "default" }))}
          >
            {t.downloadCsv}
          </a>
        </div>
        <p className="text-muted-foreground text-xs">
          {t.legend}
          {panel.truncated ? ` ${t.truncated}` : ""}
        </p>

        {panel.rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.empty}</p>
        ) : panel.days.length === 0 ? (
          <Alert variant="warning" role="status">
            <AlertDescription>{t.noDates}</AlertDescription>
          </Alert>
        ) : (
          <>
            {/* ≥sm: matriz con primera columna sticky */}
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="bg-background sticky left-0">{t.colStudent}</TableHead>
                    <TableHead>{t.colRun}</TableHead>
                    <TableHead>{t.colGroup}</TableHead>
                    {dayLabels.map((d) => (
                      <TableHead key={d} className="px-1 text-center font-mono text-xs">
                        {d}
                      </TableHead>
                    ))}
                    <TableHead>{t.colGaps}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {panel.rows.map((row) => (
                    <TableRow key={row.enrollmentId}>
                      <TableCell className="bg-background sticky left-0">
                        {row.apellidos ? `${row.apellidos}, ${row.nombres}` : row.nombres || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.run}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{groupOf(row.exento) ?? "—"}</TableCell>
                      {row.cells.map((cell) => {
                        const style = CELL_STYLE[cell.status];
                        return (
                          <TableCell
                            key={cell.date}
                            title={`${cell.date}: ${t.cell[cell.status]}`}
                            className={`px-1 text-center font-bold ${style.className}`}
                          >
                            {style.symbol}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-center">
                        {row.exento ? t.exempt : row.gaps.length}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* <sm: tarjetas por alumno */}
            <ul className="flex flex-col gap-3 sm:hidden">
              {panel.rows.map((row) => (
                <li key={row.enrollmentId}>
                  <Card className="gap-1 p-3">
                    <p className="font-medium">
                      {row.apellidos ? `${row.apellidos}, ${row.nombres}` : row.nombres || "—"}
                    </p>
                    <p className="text-muted-foreground font-mono text-xs">
                      {row.run}
                      {groupOf(row.exento) ? ` · ${groupOf(row.exento)}` : ""}
                    </p>
                    <p className="mt-1 text-sm">
                      {row.exento ? (
                        t.exempt
                      ) : (
                        <>
                          <strong>{row.gaps.length}</strong> {t.colGaps.toLowerCase()}
                          {" · "}
                          {row.cells.filter((c) => c.status === "cerrada").length}/
                          {panel.days.length} {t.daysClosed}
                        </>
                      )}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.errorsTitle}</h2>
        {panel.frequentErrors.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.noErrors}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {panel.frequentErrors.map((e) => (
              <li key={e.code}>
                <Card className="p-3 text-sm">
                  <p>
                    <span className="font-mono font-bold">{e.code}</span>
                    {" × "}
                    <strong>{e.count}</strong>
                    {" — "}
                    <span className="text-muted-foreground">{e.officialGlosa}</span>
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
