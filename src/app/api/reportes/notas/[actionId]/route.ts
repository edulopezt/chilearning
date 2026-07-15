import { NextResponse, type NextRequest } from "next/server";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getGradebookCsv } from "@/modules/evaluacion/gradebook-service";
import type { CsvLabels } from "@/modules/evaluacion/domain/gradebook";

/**
 * Export CSV del libro de notas (task 2.3, HU-6.4). El servicio autoriza
 * (VIEWERS: relator/coordinador/admin/tutor). BOM + `;` para Excel es-CL.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ actionId: string }> },
): Promise<Response> {
  const principal = await getPrincipal();
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const g = esCL.gradebook;
  const labels: CsvLabels = {
    student: g.colStudent,
    run: g.colRun,
    finalGrade: g.colFinal,
    status: g.colStatus,
    statusPassed: g.statusPassed,
    statusFailed: g.statusFailed,
    statusIncomplete: g.statusIncomplete,
    statusNoGrades: g.statusNoGrades,
  };

  const { actionId } = await params;
  const result = await getGradebookCsv(principal, actionId, labels);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return new Response(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
