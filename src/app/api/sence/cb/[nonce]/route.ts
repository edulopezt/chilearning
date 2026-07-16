import { NextResponse, type NextRequest } from "next/server";

import { handleCallback } from "@/modules/sence/engine";
import { buildEngineDeps, senceServiceClient } from "@/modules/sence/server-deps";

/**
 * POST /api/sence/cb/{nonce} — receptor de los 4 callbacks de SENCE. El `nonce`
 * de la URL (que SENCE devuelve tal cual desde UrlRetoma/UrlError) se valida
 * contra el de la sesión: bloquea la falsificación cross-sesión (H-2). PÚBLICO
 * (el POST viene del navegador del alumno, origin SENCE). Persiste SIEMPRE (I-1).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ nonce: string }> },
) {
  // SIN rate-limit y EXENTO de chequeo de origen (POST cross-origin legítimo de
  // SENCE, protegido por el nonce). I-1 exige PERSISTIR SIEMPRE: limitar aquí
  // antes de handleCallback perdería la marca de asistencia (4-ojos H1). El
  // anti-DoS del callback va en el edge/proxy, no en la app. 3.6.
  const { nonce } = await params;
  const params_ = await readForm(request);

  const deps = buildEngineDeps(request);
  const db = senceServiceClient();
  await handleCallback(db, params_, deps, nonce);

  const target = new URL("/dashboard", request.url);
  const res = NextResponse.redirect(target, { status: 303 });
  res.headers.set("cache-control", "no-store, max-age=0");
  return res;
}

async function readForm(request: NextRequest): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      const out: Record<string, string> = {};
      for (const [k, v] of form.entries()) out[k] = typeof v === "string" ? v : "";
      return out;
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v ?? "")]));
  } catch {
    return {};
  }
}
