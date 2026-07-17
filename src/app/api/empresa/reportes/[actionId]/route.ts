import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { esCL } from "@/i18n/es-CL";
import { enforce } from "@/lib/rate-limit";
import { getPrincipal } from "@/modules/core/auth/session";
import { getCompanyExport } from "@/modules/portal-empresa/company-portal-service";
import type { CompanyCertLabels } from "@/modules/portal-empresa/domain/company";

const paramsSchema = z.object({ actionId: z.string().uuid() });

/**
 * Export del panel para la empresa cliente (task 5.2, HU-8.1): GATED por
 * membresía vigente + acotado a SUS trabajadores y AUDITADO
 * (`company.report_downloaded`) en el portal-service. Solo XLSX (la CA de HU-8.1
 * pide Excel; el CSV del fiscalizador existe por el formato histórico SENCE).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ actionId: string }> },
): Promise<Response> {
  const principal = await getPrincipal();
  if (!principal || !principal.tenantId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Rate-limit por USUARIO (fail-open sin Redis): armar el XLSX cruza 5 tablas,
  // así que un tirón de descargas es caro. NO por IP: RRHH sale por la NAT de su
  // empresa y varias personas colapsarían en una sola IP (misma lección que 3.6).
  const limited = await enforce([
    { surface: "company_export", dim: "user", id: `${principal.tenantId}:${principal.userId}`, limit: 5, windowSec: 60 },
  ]);
  if (limited) return limited;

  // El Excel lo abre RRHH: el estado del certificado va en es-CL, no como el enum
  // crudo de la BD ("issued"/"revoked") bajo un encabezado en español.
  const labels: CompanyCertLabels = {
    issued: esCL.companyPortal.certIssued,
    revoked: esCL.companyPortal.certRevoked,
  };

  const result = await getCompanyExport(principal, parsed.data.actionId, labels);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${result.filename}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
