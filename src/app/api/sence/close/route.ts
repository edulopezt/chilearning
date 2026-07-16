import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { assertSameOrigin } from "@/lib/csrf";
import { enforce } from "@/lib/rate-limit";
import { tenantGuard } from "@/lib/tenant-guard";
import { getPrincipal } from "@/modules/core/auth/session";
import { readRequestBody } from "@/modules/sence/request-body";
import { renderAutoSubmitForm } from "@/modules/sence/auto-submit-form";
import { buildCloseForm } from "@/modules/sence/engine";
import { buildEngineDeps } from "@/modules/sence/server-deps";

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
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const deps = buildEngineDeps(request);
  const guard = tenantGuard(principal.tenantId);
  const result = await buildCloseForm(guard, parsed.data.sessionId, principal.userId, deps);

  if ("error" in result) {
    return NextResponse.json({ status: result.error }, { status: 409 });
  }
  return new NextResponse(renderAutoSubmitForm(result.endpoint, result.fields), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
  });
}
