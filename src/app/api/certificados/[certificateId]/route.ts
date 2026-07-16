import { NextResponse } from "next/server";

import { getPrincipal } from "@/modules/core/auth/session";
import { getCertificateDownloadUrl } from "@/modules/certificados/certificates-service";

/**
 * Descarga AUTENTICADA del PDF del certificado (task 3.2). El PDF trae el RUN
 * completo → nunca se sirve en la ruta pública. La RLS de `certificates` limita
 * a dueño/staff; devuelve una signed URL de corta vida (regenera si falta).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ certificateId: string }> },
): Promise<Response> {
  const principal = await getPrincipal();
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { certificateId } = await params;
  const url = await getCertificateDownloadUrl(principal, certificateId);
  if (!url) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.redirect(url);
}
