import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getPrincipal } from "@/modules/core/auth/session";
import { exportRowValues, EXPORT_HEADERS, toCsv } from "@/modules/reportes/domain/cumplimiento";
import { getSupervisorExport } from "@/modules/portal-empresa/supervisor-portal-service";
import { buildXlsx } from "@/modules/reportes/xlsx";

const paramsSchema = z.object({ actionId: z.string().uuid() });

/**
 * Export del panel para el fiscalizador (task 3.11): GATED por grant vigente +
 * alcance y AUDITADO (`supervisor.report_downloaded`) en el portal-service.
 * `?formato=xlsx|csv`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ actionId: string }> }): Promise<Response> {
  const principal = await getPrincipal();
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await getSupervisorExport(principal, parsed.data.actionId);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const formato = request.nextUrl.searchParams.get("formato") ?? "xlsx";
  const values = result.rows.map(exportRowValues);
  if (formato === "csv") {
    return new Response(toCsv(EXPORT_HEADERS, values), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${result.filename}.csv"`, "Cache-Control": "no-store" },
    });
  }
  const buffer = await buildXlsx("Asistencia SENCE", EXPORT_HEADERS, values);
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${result.filename}.xlsx"`, "Cache-Control": "no-store" },
  });
}
