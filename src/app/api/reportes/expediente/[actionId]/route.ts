import { NextResponse } from "next/server";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { buildExpedienteZip } from "@/modules/reportes/expediente-service";

/** Descarga del expediente completo en ZIP (task 3.12, HU-5.10). */
export async function GET(_request: Request, { params }: { params: Promise<{ actionId: string }> }): Promise<Response> {
  const principal = await getPrincipal();
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { actionId } = await params;
  const e = esCL.expediente;
  const result = await buildExpedienteZip(principal, actionId, { type: e.mType, title: e.mTitle, status: e.mStatus, definitive: e.mDefinitive, date: e.mDate, file: e.mFile });
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${result.filename}.zip"`,
      "cache-control": "no-store",
    },
  });
}
