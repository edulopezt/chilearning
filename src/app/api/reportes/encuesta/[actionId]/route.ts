import { NextResponse, type NextRequest } from "next/server";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { toCsv } from "@/modules/reportes/domain/cumplimiento";
import { buildXlsx } from "@/modules/reportes/xlsx";
import { getSurveyResultsExport } from "@/modules/evaluacion/survey-service";

const labels = {
  question: esCL.surveyResults.csvQuestion,
  type: esCL.surveyResults.csvType,
  answers: esCL.surveyResults.csvAnswers,
  summary: esCL.surveyResults.csvSummary,
  scale: esCL.surveyResults.csvScale,
  single: esCL.surveyResults.csvSingle,
  text: esCL.surveyResults.csvText,
};

/** Export de resultados de la encuesta por acción (task 3.1): `?formato=xlsx|csv`. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ actionId: string }> },
): Promise<Response> {
  const principal = await getPrincipal();
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { actionId } = await params;
  const result = await getSurveyResultsExport(principal, actionId, labels);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const formato = request.nextUrl.searchParams.get("formato") ?? "xlsx";
  if (formato === "csv") {
    return new Response(toCsv(result.headers, result.rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const buffer = await buildXlsx("Encuesta", result.headers, result.rows);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${result.filename}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
