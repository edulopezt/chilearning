import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getPrincipal } from "@/modules/core/auth/session";
import { toCsv } from "@/modules/reportes/domain/cumplimiento";
import { buildXlsx } from "@/modules/reportes/xlsx";
import { exportRoster } from "@/modules/dj/dj-service";

const paramsSchema = z.object({ actionId: z.string().uuid() });

/** Nómina de DJ para la GCA (task 3.3): `?formato=xlsx|csv`. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ actionId: string }> }): Promise<Response> {
  const principal = await getPrincipal();
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { actionId } = parsed.data;
  const result = await exportRoster(principal, actionId);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const formato = request.nextUrl.searchParams.get("formato") ?? "xlsx";
  if (formato === "csv") {
    return new Response(toCsv(result.headers, result.rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${result.filename}.csv"`, "Cache-Control": "no-store" },
    });
  }
  const buffer = await buildXlsx("DJ", result.headers, result.rows);
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${result.filename}.xlsx"`, "Cache-Control": "no-store" },
  });
}
