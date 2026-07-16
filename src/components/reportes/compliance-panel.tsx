import { esCL } from "@/i18n/es-CL";
import { BECARIO_LABEL } from "@/modules/academico/domain/enrollment-group";
import type { CompliancePanel } from "@/modules/reportes/cumplimiento-service";
import type { DayCellStatus } from "@/modules/reportes/domain/cumplimiento";

const t = esCL.cumplimiento;

const CELL_STYLE: Record<DayCellStatus, { symbol: string; className: string; label: string }> = {
  cerrada: { symbol: "✓", className: "text-green-700 dark:text-green-400", label: "cerrada" },
  iniciada: { symbol: "◐", className: "text-amber-700 dark:text-amber-400", label: "iniciada" },
  error: { symbol: "✕", className: "text-red-600", label: "error" },
  none: { symbol: "·", className: "text-neutral-400", label: "none" },
  exento: { symbol: "—", className: "text-neutral-400", label: "exento" },
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
          <a href={`${exportBasePath}?formato=xlsx`} className="min-h-11 rounded-md border px-4 py-2 text-sm font-medium underline-offset-2 hover:underline">
            {t.downloadXlsx}
          </a>
          <a href={`${exportBasePath}?formato=csv`} className="min-h-11 rounded-md border px-4 py-2 text-sm font-medium underline-offset-2 hover:underline">
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
          <p className="text-sm text-amber-700 dark:text-amber-400">{t.noDates}</p>
        ) : (
          <>
            {/* ≥sm: matriz con primera columna sticky */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="bg-background sticky left-0 py-2 pr-3">{t.colStudent}</th>
                    <th className="py-2 pr-3">{t.colRun}</th>
                    <th className="py-2 pr-3">{t.colGroup}</th>
                    {dayLabels.map((d) => (
                      <th key={d} className="px-1 py-2 text-center font-mono text-xs">
                        {d}
                      </th>
                    ))}
                    <th className="py-2 pl-3">{t.colGaps}</th>
                  </tr>
                </thead>
                <tbody>
                  {panel.rows.map((row) => (
                    <tr key={row.enrollmentId} className="border-b last:border-0">
                      <td className="bg-background sticky left-0 py-2 pr-3">
                        {row.apellidos ? `${row.apellidos}, ${row.nombres}` : row.nombres || "—"}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{row.run}</td>
                      <td className="py-2 pr-3 text-xs whitespace-nowrap">{groupOf(row.exento) ?? "—"}</td>
                      {row.cells.map((cell) => {
                        const style = CELL_STYLE[cell.status];
                        return (
                          <td
                            key={cell.date}
                            title={`${cell.date}: ${t.cell[cell.status]}`}
                            className={`px-1 py-2 text-center font-bold ${style.className}`}
                          >
                            {style.symbol}
                          </td>
                        );
                      })}
                      <td className="py-2 pl-3 text-center">
                        {row.exento ? t.exempt : row.gaps.length}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* <sm: tarjetas por alumno */}
            <ul className="flex flex-col gap-3 sm:hidden">
              {panel.rows.map((row) => (
                <li key={row.enrollmentId} className="rounded-md border p-3">
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
              <li key={e.code} className="rounded-md border p-3 text-sm">
                <span className="font-mono font-bold">{e.code}</span>
                {" × "}
                <strong>{e.count}</strong>
                {" — "}
                <span className="text-muted-foreground">{e.officialGlosa}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
