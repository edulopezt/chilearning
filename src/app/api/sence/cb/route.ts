import { NextResponse, type NextRequest } from "next/server";

import { handleCallback } from "@/modules/sence/engine";
import { buildEngineDeps, senceServiceClient } from "@/modules/sence/server-deps";

/**
 * POST /api/sence/cb — receptor ÚNICO de los 4 callbacks de SENCE (inicio/cierre,
 * éxito/error). PÚBLICO (el POST viene del navegador del alumno, origin SENCE, sin
 * sesión). Persiste SIEMPRE el evento (I-1), idempotente (I-3), y transiciona la
 * sesión. Luego redirige al alumno de vuelta al curso.
 */
export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  let params: Record<string, string> = {};
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      for (const [k, v] of form.entries()) params[k] = typeof v === "string" ? v : "";
    } else {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      params = Object.fromEntries(
        Object.entries(body).map(([k, v]) => [k, String(v ?? "")]),
      );
    }
  } catch {
    params = {};
  }

  // Sin nonce en la URL: nunca correlaciona una sesión (se persiste unmatched).
  // El receptor real es /api/sence/cb/{nonce}. Esta ruta solo cae basura/ataques.
  const deps = buildEngineDeps(request.url);
  const db = senceServiceClient();
  await handleCallback(db, params, deps, null);

  const target = new URL("/dashboard", request.url);
  const res = NextResponse.redirect(target, { status: 303 });
  res.headers.set("cache-control", "no-store, max-age=0");
  return res;
}
