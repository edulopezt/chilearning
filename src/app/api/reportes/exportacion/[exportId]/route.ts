import { NextResponse } from "next/server";
import { z } from "zod";

import { enforce } from "@/lib/rate-limit";
import { getPrincipal } from "@/modules/core/auth/session";
import { getExportDownloadUrl } from "@/modules/reportes/tenant-export-service";

const paramsSchema = z.object({ exportId: z.string().uuid() });

/**
 * Descarga AUTENTICADA del ZIP del export completo del tenant (task 5.13,
 * HU-1.5). El servicio verifica tenant + `status = 'done'` antes de firmar y
 * audita la descarga; esta ruta solo autentica, valida el parámetro, aplica el
 * rate-limit y redirige 303 al signed URL (que expira en 1 h).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ exportId: string }> },
): Promise<Response> {
  const principal = await getPrincipal();
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Rate-limit por USUARIO (fail-open sin Redis): firmar la URL es barato, pero
  // el ZIP puede ser de cientos de MB — sin límite, un tirón de "descargas"
  // podría multiplicar el tráfico de egreso del bucket sin ninguna razón legítima.
  const limited = await enforce([
    { surface: "tenant_export_download", dim: "user", id: principal.userId, limit: 10, windowSec: 60 },
  ]);
  if (limited) return limited;

  const url = await getExportDownloadUrl(principal, parsed.data.exportId);
  if (!url) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.redirect(url, 303);
}
