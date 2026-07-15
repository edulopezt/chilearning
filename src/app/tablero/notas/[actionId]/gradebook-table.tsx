import { esCL } from "@/i18n/es-CL";
import { rowStatus, type Gradebook, type GradebookRow } from "@/modules/evaluacion/domain/gradebook";

const t = esCL.gradebook;

const STATUS: Record<ReturnType<typeof rowStatus>, { label: string; className: string }> = {
  passed: { label: t.statusPassed, className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  failed: { label: t.statusFailed, className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  incomplete: { label: t.statusIncomplete, className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
  none: { label: t.statusNoGrades, className: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300" },
};

function StatusBadge({ row }: { row: GradebookRow }) {
  const s = STATUS[rowStatus(row)];
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>;
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

  if (rows.length === 0) return <p className="text-muted-foreground text-sm">{t.empty}</p>;
  if (instruments.length === 0) return <p className="text-sm text-amber-700 dark:text-amber-400">{t.noInstruments}</p>;

  return (
    <>
      {/* ≥sm: matriz */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="bg-background sticky left-0 py-2 pr-3">{t.colStudent}</th>
              <th className="py-2 pr-3">{t.colRun}</th>
              {instruments.map((i) => (
                <th key={i.id} className="px-2 py-2 text-center">
                  {i.title}
                  <span className="text-muted-foreground block text-xs font-normal">
                    {t.weightLabel} {i.weight}
                  </span>
                </th>
              ))}
              <th className="px-2 py-2 text-center">{t.colFinal}</th>
              <th className="py-2 pl-3">{t.colStatus}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.enrollmentId} className="border-b last:border-0">
                <td className="bg-background sticky left-0 py-2 pr-3">{row.name}</td>
                <td className="py-2 pr-3 font-mono text-xs">{row.run || "—"}</td>
                {row.cells.map((c) => (
                  <td key={c.instrumentId} className="px-2 py-2 text-center tabular-nums">
                    {grade(c.grade)}
                  </td>
                ))}
                <td className="px-2 py-2 text-center font-semibold tabular-nums">{grade(row.finalGrade)}</td>
                <td className="py-2 pl-3">
                  <StatusBadge row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* <sm: tarjetas por alumno */}
      <ul className="flex flex-col gap-3 sm:hidden">
        {rows.map((row) => (
          <li key={row.enrollmentId} className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{row.name}</span>
              <StatusBadge row={row} />
            </div>
            <p className="text-muted-foreground font-mono text-xs">{row.run || "—"}</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              {instruments.map((i, idx) => (
                <div key={i.id} className="flex justify-between gap-2">
                  <dt className="text-muted-foreground truncate">{i.title}</dt>
                  <dd className="tabular-nums">{grade(row.cells[idx]?.grade ?? null)}</dd>
                </div>
              ))}
            </dl>
            <p className="border-t pt-2 text-sm">
              <span className="text-muted-foreground">{t.colFinal}: </span>
              <strong className="tabular-nums">{grade(row.finalGrade)}</strong>
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
