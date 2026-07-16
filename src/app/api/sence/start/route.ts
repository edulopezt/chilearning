import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { assertSameOrigin } from "@/lib/csrf";
import { enforce } from "@/lib/rate-limit";
import { tenantGuard } from "@/lib/tenant-guard";
import { getPrincipal } from "@/modules/core/auth/session";
import { readRequestBody } from "@/modules/sence/request-body";
import { renderAutoSubmitForm } from "@/modules/sence/auto-submit-form";
import { startSession } from "@/modules/sence/engine";
import { buildEngineDeps } from "@/modules/sence/server-deps";

const bodySchema = z.object({ enrollmentId: z.string().uuid() });

/**
 * POST /api/sence/start — inicia el registro de asistencia (T1). Solo el alumno
 * inscrito. Devuelve una página que auto-envía el form POST hacia SENCE. Acepta
 * JSON o form-urlencoded (el botón del curso hace un submit nativo).
 */
export async function POST(request: NextRequest) {
  // Anti-CSRF: rechaza un POST cross-site (mismo-origen del botón del curso). 3.6.
  if (!assertSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }
  const principal = await getPrincipal();
  if (!principal || !principal.tenantId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Rate-limit por USUARIO (fail-open sin Redis): 10/min. NO por IP — cohortes
  // tras NAT compartido (empresa/laboratorio) colapsarían en una IP y bloquearían
  // a alumnos reales (4-ojos H1). Un usuario no puede afectar a otro. 3.6.
  const limited = await enforce([
    { surface: "sence_start", dim: "user", id: `${principal.tenantId}:${principal.userId}`, limit: 10, windowSec: 60 },
  ]);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readRequestBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const deps = buildEngineDeps(request);
  const guard = tenantGuard(principal.tenantId);
  const result = await startSession(guard, parsed.data.enrollmentId, principal.userId, deps);

  switch (result.kind) {
    case "exempt":
      return NextResponse.json({ status: "exempt" });
    case "preflight_error":
      // No se envía al alumno a SENCE si el pre-vuelo falla (I-8).
      return NextResponse.json(
        { status: "preflight_error", violations: result.violations },
        { status: 422 },
      );
    case "ready":
      // no-store: la página lleva el token del OTEC en el form hacia SENCE (I-7);
      // no debe quedar en caché de navegador ni de proxies (M-2).
      return new NextResponse(renderAutoSubmitForm(result.endpoint, result.fields), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store, max-age=0",
        },
      });
  }
}
