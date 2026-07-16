import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { esCL } from "@/i18n/es-CL";
import { assertSameOrigin } from "@/lib/csrf";
import { enforce } from "@/lib/rate-limit";
import { tenantGuard } from "@/lib/tenant-guard";
import { getPrincipal } from "@/modules/core/auth/session";
import { readRequestBody } from "@/modules/sence/request-body";
import { renderAutoSubmitForm } from "@/modules/sence/auto-submit-form";
import { renderMessagePage } from "@/modules/sence/message-page";
import { buildCloseForm } from "@/modules/sence/engine";
import { buildEngineDeps } from "@/modules/sence/server-deps";

/** Página HTML es-CL para el alumno (I-9): submit nativo → nunca JSON crudo (H4-R-012). */
function studentMessage(body: string, status: number, request: NextRequest): NextResponse {
  const html = renderMessagePage({
    title: esCL.course.attendanceProblem,
    body,
    backHref: new URL("/mi-curso", request.url).toString(),
    backLabel: esCL.course.backToCourse,
  });
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, max-age=0" },
  });
}

const bodySchema = z.object({ sessionId: z.string().uuid() });

/**
 * POST /api/sence/close — cierra la sesión de asistencia (T5/T8). Devuelve una
 * página que auto-envía el form POST de CerrarSesion hacia SENCE.
 */
export async function POST(request: NextRequest) {
  if (!assertSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }
  const principal = await getPrincipal();
  if (!principal || !principal.tenantId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limited = await enforce([
    { surface: "sence_close", dim: "user", id: `${principal.tenantId}:${principal.userId}`, limit: 10, windowSec: 60 },
  ]);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readRequestBody(request));
  if (!parsed.success) {
    return studentMessage(esCL.course.closeError, 400, request);
  }

  const deps = buildEngineDeps(request);
  const guard = tenantGuard(principal.tenantId);
  const result = await buildCloseForm(guard, parsed.data.sessionId, principal.userId, deps);

  if ("error" in result) {
    // `not_closable`: la sesión no está en un estado que permita cerrar (o no es
    // del alumno). Mensaje es-CL en vez de JSON `{status:...}` (H4-R-012, I-9).
    return studentMessage(esCL.course.closeError, 409, request);
  }
  return new NextResponse(renderAutoSubmitForm(result.endpoint, result.fields), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
  });
}
