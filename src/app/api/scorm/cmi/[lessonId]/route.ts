import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { assertSameOrigin } from "@/lib/csrf";
import { enforce } from "@/lib/rate-limit";
import { MAX_CMI_BYTES } from "@/modules/contenido/domain/cmi";
import { getScormCmiState, saveScormCmiState } from "@/modules/contenido/scorm-runtime-service";
import { getPrincipal } from "@/modules/core/auth/session";

/**
 * Persistencia CMI del reproductor SCORM (task 5.1b, HU-4.2, ADR-006): GET
 * devuelve el último estado guardado (o vacío, primer intento); POST lo
 * actualiza (autosave del cliente) y, si el intento se reporta completo,
 * marca `lesson_progress` (vía el servicio, no acá). Nunca 403: sin acceso
 * válido responde 404 (anti-enumeración).
 */

const bodySchema = z.object({ cmi: z.record(z.string(), z.unknown()) });

// Margen sobre MAX_CMI_BYTES para el chequeo por `content-length` (cubre el
// envoltorio `{"cmi":...}` + espacios): NO reemplaza el guard exacto en bytes
// de `saveScormCmiState` (que mide el objeto `cmi` ya parseado), solo evita
// parsear el body completo y golpear la BD para payloads YA descartables por
// tamaño (corrección 4-ojos MED, task 5.1b).
const CONTENT_LENGTH_OVERHEAD_BYTES = 1024;

function notFound(): NextResponse {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

function tooLarge(): NextResponse {
  return NextResponse.json({ error: "too_large" }, { status: 413 });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ lessonId: string }> },
): Promise<Response> {
  const principal = await getPrincipal();
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { lessonId } = await params;
  const state = await getScormCmiState(principal, lessonId);
  if (!state) return notFound();
  return NextResponse.json(state);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ lessonId: string }> },
): Promise<Response> {
  // Anti-CSRF: el autosave del reproductor es same-origin (fetch/sendBeacon
  // desde la propia página del curso), igual que el resto de mutaciones 3.6.
  if (!assertSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }
  const principal = await getPrincipal();
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // El reproductor autosalva seguido (debounce 2 s + heartbeat 30 s): límite
  // generoso por usuario, fail-open sin Redis (RNF-6 > estrictez del límite).
  const limited = await enforce([
    { surface: "scorm_cmi", dim: "user", id: `${principal.tenantId ?? "no-tenant"}:${principal.userId}`, limit: 30, windowSec: 60 },
  ]);
  if (limited) return limited;

  // Rechazo temprano por tamaño: ANTES de parsear el body completo y de la
  // resolución de acceso (2-4 queries a Postgres en `resolveStudentScormAccess`)
  // — sin esto, cualquier usuario autenticado (tenga o no acceso al lessonId)
  // podía forzar ese trabajo con un body arbitrariamente grande antes de que
  // el guard de tamaño lo rechazara.
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_CMI_BYTES + CONTENT_LENGTH_OVERHEAD_BYTES) {
    return tooLarge();
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const { lessonId } = await params;
  const result = await saveScormCmiState(principal, lessonId, parsed.data.cmi);
  if (!result.ok) {
    const status = result.error === "too_large" ? 413 : 404;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
