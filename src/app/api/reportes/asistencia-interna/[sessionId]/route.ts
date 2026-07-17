import { NextResponse, type NextRequest } from "next/server";

import { enforce } from "@/lib/rate-limit";
import { exportAttendanceCsv } from "@/modules/academico/live-session-service";
import { getPrincipal } from "@/modules/core/auth/session";

/**
 * Export CSV de asistencia INTERNA de una sesión en vivo (task 5.4, spec §7-R3).
 * STAFF (otec_admin/coordinator/instructor/tutor, vía `attendanceForSession`).
 * NO es un reporte SENCE: el CSV lleva el disclaimer como primera línea.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const principal = await getPrincipal();
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limited = await enforce([
    { surface: "live_attendance_export", dim: "user", id: principal.userId, limit: 20, windowSec: 60 },
  ]);
  if (limited) return limited;

  const { sessionId } = await params;
  const result = await exportAttendanceCsv(principal, sessionId);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return new Response(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
