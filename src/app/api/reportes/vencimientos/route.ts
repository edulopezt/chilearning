import { NextResponse, type NextRequest } from "next/server";

import { esCL } from "@/i18n/es-CL";
import { enforce } from "@/lib/rate-limit";
import { buildExpirationsXlsx } from "@/modules/certificados/expiry-report-service";
import { getPrincipal } from "@/modules/core/auth/session";

/**
 * Export XLSX del listado de vencimientos (task 5.12, HU-7.3). El servicio
 * autoriza (otec_admin/coordinator), enmascara el RUN y audita la descarga.
 *
 * Rate-limit por USUARIO: armar el Excel recorre todos los certificados vigentes
 * del tenant, así que es el endpoint más caro de esta feature y no hay razón
 * legítima para pedirlo 6 veces por minuto.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const principal = await getPrincipal();
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limited = await enforce([
    { surface: "expiry_export", dim: "user", id: principal.userId, limit: 5, windowSec: 60 },
  ]);
  if (limited) return limited;

  const params = request.nextUrl.searchParams;
  const companyId = params.get("companyId");
  const windowRaw = Number(params.get("windowDays"));
  const t = esCL.certExpiry;

  const result = await buildExpirationsXlsx(
    principal,
    {
      // "all" y vacío = sin filtro; "none" = solo particulares (sentinel del servicio).
      companyId: companyId && companyId !== "all" ? companyId : null,
      windowDays: Number.isInteger(windowRaw) && windowRaw > 0 ? windowRaw : null,
    },
    { particular: t.particular, expired: t.expired },
  );
  if (!result) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${result.filename}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
