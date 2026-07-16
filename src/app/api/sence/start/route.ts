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
import { startSession } from "@/modules/sence/engine";
import { buildEngineDeps } from "@/modules/sence/server-deps";

/** Página HTML es-CL para el alumno (I-9): el botón del curso hace submit nativo,
 *  así que la respuesta se RENDERIZA — nunca JSON crudo (H4-R-012). */
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
    return studentMessage(esCL.course.startError, 400, request);
  }

  const deps = buildEngineDeps(request);
  const guard = tenantGuard(principal.tenantId);
  const result = await startSession(guard, parsed.data.enrollmentId, principal.userId, deps);

  switch (result.kind) {
    case "exempt":
      // El alumno exento (becario) no registra SENCE: lo llevamos a su curso, que
      // ya le muestra el contenido desbloqueado (I-14).
      return NextResponse.redirect(new URL("/mi-curso", request.url), { status: 303 });
    case "already_open":
      // Ya hay una sesión viva para esta inscripción (doble-click, dos pestañas, o
      // la de 3 h vencida que el worker aún no barrió). El botón del curso hace un
      // submit nativo, así que se lleva al alumno de vuelta a su curso —donde verá
      // su estado actual— en vez de un 500 crudo (H4-R-016, espíritu de I-9).
      return NextResponse.redirect(new URL("/mi-curso", request.url), { status: 303 });
    case "preflight_error":
      // No se envía al alumno a SENCE si el pre-vuelo falla (I-8). El alumno no
      // puede accionar una violación de pre-vuelo (RUN/config): mensaje es-CL
      // genérico en vez de JSON de violaciones (H4-R-012, I-9).
      return studentMessage(esCL.course.startError, 422, request);
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
