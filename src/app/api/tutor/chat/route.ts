import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { assertSameOrigin } from "@/lib/csrf";
import { enforce } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPrincipal } from "@/modules/core/auth/session";
import { aiClientFromEnv } from "@/modules/tutor-ia/ai-client";
import { reserveBudgetForContext, resolveTutorContext, streamTutorAnswer } from "@/modules/tutor-ia/tutor-chat-service";

/**
 * Chat del Tutor IA (task 5.8b, HU-11.1/11.2/11.3), streaming SSE PROPIO —
 * el cliente NUNCA ve el wire format de OpenRouter. Mismo orden de guardas
 * que `scorm/cmi/[lessonId]/route.ts`: origen → sesión → rate-limit →
 * validación → lógica → respuesta. La lógica de negocio (gate, presupuesto,
 * conversación, retrieval, prompt, persistencia) vive en
 * `tutor-chat-service.ts` — esta ruta es un wrapper delgado que traduce sus
 * resultados a HTTP/SSE, sin lógica propia (mismo criterio documentado en
 * `scorm-runtime.integration.test.ts`: por depender de `next/headers`, este
 * archivo no tiene test propio; la lógica que traduce SÍ está cubierta en el
 * service).
 */

const bodySchema = z.object({ question: z.string().trim().min(1).max(2000) });

// `not_configured` es un problema de disponibilidad de la plataforma (falta
// configurar el proveedor de IA), no de permisos del alumno -> 503, no 403.
const GATE_STATUS: Partial<Record<string, number>> = { not_configured: 503 };

export async function POST(request: NextRequest): Promise<Response> {
  // Anti-CSRF: el chat es same-origin (fetch desde /mi-curso/tutor).
  if (!assertSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }

  const principal = await getPrincipal();
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limited = await enforce([
    {
      surface: "tutor_chat",
      dim: "user",
      id: `${principal.tenantId ?? "no-tenant"}:${principal.userId}`,
      limit: 10,
      windowSec: 60,
    },
  ]);
  if (limited) return limited;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { question } = parsed.data;

  const gate = await resolveTutorContext(principal);
  if (!gate.ok) {
    // El código de bloqueo se traduce SIEMPRE en el cliente (esCL.tutorIA.*),
    // nunca se muestra crudo al alumno (mismo principio que los errores SENCE).
    return NextResponse.json({ error: gate.reason }, { status: GATE_STATUS[gate.reason] ?? 403 });
  }
  const { context } = gate;

  // Cliente de SESIÓN, capturado ANTES de la reserva de presupuesto y del
  // streaming: tanto la reserva atómica (`reserveBudgetForContext`) como las
  // RPCs de uso/costo lo exigen (ver `tutor-chat-service.ts`/las migraciones
  // de 5.8a-b).
  const sessionDb = await createSupabaseServerClient();

  // Reserva ATÓMICA del cupo — cierra el TOCTOU (hallazgo de revisión de
  // seguridad, 2026-07-18): el mensaje queda contado AQUÍ, antes de invocar
  // al proveedor de IA, no al final del streaming.
  const budget = await reserveBudgetForContext(context, sessionDb);
  if (!budget.ok) {
    return NextResponse.json({ error: budget.reason }, { status: 429 });
  }

  const aiClient = aiClientFromEnv(process.env);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const evt of streamTutorAnswer(context, { aiClient, sessionDb }, question)) {
          if (evt.type === "delta") {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "delta", text: evt.text })}\n\n`));
          } else if (evt.type === "final") {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "final",
                  citations: evt.citations,
                  conversationId: evt.conversationId,
                })}\n\n`,
              ),
            );
          } else {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: "upstream_error" })}\n\n`));
          }
        }
      } catch (err) {
        // Nunca se puede cambiar el status code una vez iniciado el
        // streaming: se cierra con un frame de error en vez de dejar la
        // conexión colgada o intentar un 500.
        console.error("[tutor-ia] fallo inesperado streameando la respuesta del tutor", {
          message: (err as Error).message,
        });
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: "upstream_error" })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
