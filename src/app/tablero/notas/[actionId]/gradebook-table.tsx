import { esCL } from "@/i18n/es-CL";
import { rowStatus, type Gradebook, type GradebookRow } from "@/modules/evaluacion/domain/gradebook";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const t = esCL.gradebook;

const STATUS: Record<ReturnType<typeof rowStatus>, { label: string; variant: "success" | "destructive" | "warning" | "secondary" }> = {
  passed: { label: t.statusPassed, variant: "success" },
  failed: { label: t.statusFailed, variant: "destructive" },
  incomplete: { label: t.statusIncomplete, variant: "warning" },
  none: { label: t.statusNoGrades, variant: "secondary" },
};

function StatusBadge({ row }: { row: GradebookRow }) {
  const s = STATUS[rowStatus(row)];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

function grade(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

/**
 * Libro de notas (task 2.3, HU-6.4): matriz alumno × instrumento + nota final
 * y estado. ≥sm tabla con scroll horizontal y primera columna sticky; <sm
 * colapsa a tarjetas por alumno (RNF-6).
 */
export function GradebookTable({ gradebook }: { gradebook: Gradebook }) {
  const { instruments, rows } = gradebook;

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t.empty}</p>;
  if (instruments.length === 0) return <p className="text-sm text-warning">{t.noInstruments}</p>;

  return (
    <>
      {/* ≥sm: matriz */}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-background">{t.colStudent}</TableHead>
              <TableHead>{t.colRun}</TableHead>
              {instruments.map((i) => (
                <TableHead key={i.id} className="text-center">
                  {i.title}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {t.weightLabel} {i.weight}
                  </span>
                </TableHead>
              ))}
              <TableHead className="text-center">{t.colFinal}</TableHead>
              <TableHead>{t.colStatus}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.enrollmentId}>
                <TableCell className="sticky left-0 bg-background font-medium">{row.name}</TableCell>
                <TableCell className="font-mono text-xs">{row.run || "—"}</TableCell>
                {row.cells.map((c) => (
                  <TableCell key={c.instrumentId} className="text-center tabular-nums">
                    {grade(c.grade)}
                  </TableCell>
                ))}
                <TableCell className="text-center font-semibold tabular-nums">{grade(row.finalGrade)}</TableCell>
                <TableCell>
                  <StatusBadge row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* <sm: tarjetas por alumno */}
      <ul className="flex flex-col gap-3 sm:hidden">
        {rows.map((row) => (
          <li key={row.enrollmentId}>
            <Card className="gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{row.name}</span>
                <StatusBadge row={row} />
              </div>
              <p className="font-mono text-xs text-muted-foreground">{row.run || "—"}</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                {instruments.map((i, idx) => (
                  <div key={i.id} className="flex justify-between gap-2">
                    <dt className="truncate text-muted-foreground">{i.title}</dt>
                    <dd className="tabular-nums">{grade(row.cells[idx]?.grade ?? null)}</dd>
                  </div>
                ))}
              </dl>
              <p className="border-t pt-3 text-sm">
                <span className="text-muted-foreground">{t.colFinal}: </span>
                <strong className="tabular-nums">{grade(row.finalGrade)}</strong>
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
