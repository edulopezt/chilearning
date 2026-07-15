import { NextResponse, type NextRequest } from "next/server";

import { getPrincipal } from "@/modules/core/auth/session";
import {
  exportRowValues,
  EXPORT_HEADERS,
  toCsv,
} from "@/modules/reportes/domain/cumplimiento";
import { getComplianceExport } from "@/modules/reportes/cumplimiento-service";
import { buildXlsx } from "@/modules/reportes/xlsx";

/**
 * Export del panel de cumplimiento (task 2.4, HU-5.5): `?formato=xlsx|csv`.
 * Ruta NEUTRAL (no /admin): la comparten coordinador/admin y el portal del
 * fiscalizador (2.5) — el servicio autoriza (VIEWERS incluye supervisor).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ actionId: string }> },
): Promise<Response> {
  const principal = await getPrincipal();
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { actionId } = await params;
  const result = await getComplianceExport(principal, actionId);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const formato = request.nextUrl.searchParams.get("formato") ?? "xlsx";
  const values = result.rows.map(exportRowValues);

  if (formato === "csv") {
    return new Response(toCsv(EXPORT_HEADERS, values), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const buffer = await buildXlsx("Asistencia SENCE", EXPORT_HEADERS, values);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${result.filename}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
