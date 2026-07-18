import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { writeAudit } from "@/lib/audit";
import { requireFeature } from "@/lib/feature-flags";
import { tenantGuard, type TenantGuard } from "@/lib/tenant-guard";
import { getStudentCourseView } from "@/modules/academico/course-view";
import { hasRole, type Principal } from "@/modules/core/domain/rbac";
import type { AiClient, ChatMessage } from "@/modules/tutor-ia/ai-client";
import { aiClientFromEnv } from "@/modules/tutor-ia/ai-client";
import { checkTutorBudget, DEFAULT_DAILY_MESSAGE_LIMIT, type TutorBudgetBlockReason } from "@/modules/tutor-ia/domain/budget";
import { buildTutorPrompt, extractTutorContext, mapCitations, type TutorPromptHistoryEntry } from "@/modules/tutor-ia/domain/prompt";
import { searchChunks } from "@/modules/tutor-ia/retrieval";

/**
 * Orquestación del chat del Tutor IA (task 5.8b, HU-11.1/11.2/11.3):
 * gate de acceso, presupuesto, conversación/historial y el streaming de la
 * respuesta. `import "server-only"`: usa `tenantGuard()` y (para el gate)
 * `getStudentCourseView()` — ambos exclusivos del server de Next.
 *
 * Minimización (RNF-10): `TutorContext` guarda SOLO lo que `buildTutorPrompt`
 * puede recibir (courseName/firstName/aggregateProgress) más los ids técnicos
 * que necesita la CAPA DE PERSISTENCIA (tenantId/userId/enrollmentId/courseId
 * — nunca se le pasan a `buildTutorPrompt`, cuya firma sigue siendo la lista
 * blanca de `domain/prompt.ts`).
 *
 * Presupuesto (HU-11.2): el enforcement real usa `reserveBudgetForContext`
 * (reserva ATÓMICA vía RPC, llamada desde `route.ts` antes de invocar al
 * proveedor de IA) — `checkBudgetForContext` es solo una lectura de
 * diagnóstico/preview, sin valor de gateo (ver el docstring de cada una).
 */

export type TutorGateBlockReason =
  | "not_student"
  | "no_enrollment"
  | "feature_disabled"
  | "course_disabled"
  | "not_configured";

export interface TutorContext {
  readonly guard: TenantGuard;
  readonly tenantId: string;
  readonly userId: string;
  readonly enrollmentId: string;
  readonly courseId: string;
  readonly courseName: string;
  readonly firstName: string;
  readonly aggregateProgress: { readonly completed: number; readonly total: number };
}

export type TutorGateResult =
  | { readonly ok: true; readonly context: TutorContext }
  | { readonly ok: false; readonly reason: TutorGateBlockReason };

/**
 * Gate de acceso al Tutor IA para el alumno autenticado. Orden estricto (cada
 * paso solo se evalúa si el anterior pasó): rol student → inscripción real →
 * feature del tenant → config del curso → proveedor de IA configurado.
 */
export async function resolveTutorContext(principal: Principal): Promise<TutorGateResult> {
  if (!hasRole(principal, "student") || !principal.tenantId) {
    return { ok: false, reason: "not_student" };
  }
  const tenantId = principal.tenantId;

  const view = await getStudentCourseView();
  if (!view) return { ok: false, reason: "no_enrollment" };

  const guard = tenantGuard(tenantId);

  const featureOn = await requireFeature(guard, tenantId, "ai_tutor");
  if (!featureOn) return { ok: false, reason: "feature_disabled" };

  const { data: courseConfig } = await guard.db
    .from("tutor_course_config")
    .select("enabled")
    .eq("tenant_id", tenantId)
    .eq("course_id", view.courseId)
    .maybeSingle();
  if (!courseConfig?.enabled) return { ok: false, reason: "course_disabled" };

  const aiClient = aiClientFromEnv(process.env);
  if (!aiClient.configured) return { ok: false, reason: "not_configured" };

  // Nombre del alumno: mismo mecanismo que `certificates-service.ts`
  // (snapshot `enrollments.first_names`/`last_names`, task 2.4a) — NUNCA la
  // Admin API paginada (`guide-service.ts`), innecesaria aquí porque ya
  // conocemos el `enrollment_id` exacto. `extractTutorContext` es la ÚNICA
  // puerta hacia el prompt: sanea cualquier basura (RUN/correo/empresa) que
  // pudiera venir en el snapshot.
  const { data: enrollmentRow } = await guard.db
    .from("enrollments")
    .select("first_names, last_names")
    .eq("tenant_id", tenantId)
    .eq("id", view.enrollmentId)
    .maybeSingle();
  const fullName = [enrollmentRow?.first_names ?? "", enrollmentRow?.last_names ?? ""].join(" ").trim();
  const { firstName } = extractTutorContext(principal, fullName);

  return {
    ok: true,
    context: {
      guard,
      tenantId,
      userId: principal.userId,
      enrollmentId: view.enrollmentId,
      courseId: view.courseId,
      courseName: view.courseName,
      firstName,
      aggregateProgress: { completed: view.completedLessonIds.length, total: view.lessons.length },
    },
  };
}

/** Límites CONFIGURADOS (curso + tenant) del presupuesto — sin contadores, sin
 *  IO de escritura. Compartido por `checkBudgetForContext` (lectura) y
 *  `reserveBudgetForContext` (reserva atómica). */
async function resolveBudgetLimits(
  context: TutorContext,
): Promise<{ readonly dailyLimit: number; readonly monthlyBudget: number }> {
  const [{ data: courseConfig }, { data: budgetRow }] = await Promise.all([
    context.guard.db
      .from("tutor_course_config")
      .select("daily_message_limit")
      .eq("tenant_id", context.tenantId)
      .eq("course_id", context.courseId)
      .maybeSingle(),
    context.guard.db
      .from("tutor_tenant_budget")
      .select("monthly_token_budget")
      .eq("tenant_id", context.tenantId)
      .maybeSingle(),
  ]);

  const dailyLimit = (courseConfig?.daily_message_limit as number | null | undefined) ?? DEFAULT_DAILY_MESSAGE_LIMIT;
  const monthlyBudget =
    (budgetRow?.monthly_token_budget as number | null | undefined) ??
    Number(process.env.AI_MONTHLY_TOKEN_BUDGET_DEFAULT ?? 1_000_000);

  return { dailyLimit, monthlyBudget };
}

/**
 * Presupuesto (HU-11.2), LECTURA pura — NO reserva nada. Útil para
 * diagnóstico/preview del estado actual, pero NUNCA para gatear el envío de
 * un mensaje real: entre esta lectura y cualquier incremento posterior hay
 * una ventana de carrera (TOCTOU, hallazgo de revisión de seguridad,
 * 2026-07-18) — ver `reserveBudgetForContext`, la única puerta atómica que se
 * usa para el enforcement real en `route.ts`.
 */
export async function checkBudgetForContext(
  context: TutorContext,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: TutorBudgetBlockReason }> {
  const today = new Date().toISOString().slice(0, 10);
  const { dailyLimit, monthlyBudget } = await resolveBudgetLimits(context);

  const { data: usageToday } = await context.guard.db
    .from("tutor_usage_daily")
    .select("messages")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", context.userId)
    .eq("day", today)
    .maybeSingle();
  const messagesToday = (usageToday?.messages as number | undefined) ?? 0;

  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const { data: monthRows } = await context.guard.db
    .from("tutor_usage_daily")
    .select("input_tokens, output_tokens")
    .eq("tenant_id", context.tenantId)
    .gte("day", firstOfMonth);
  const tenantTokensThisMonth = (monthRows ?? []).reduce(
    (sum, r) => sum + Number(r.input_tokens ?? 0) + Number(r.output_tokens ?? 0),
    0,
  );

  const result = checkTutorBudget({ messagesToday, dailyLimit, tenantTokensThisMonth, monthlyBudget });
  return result.allowed ? { ok: true } : { ok: false, reason: result.reason as TutorBudgetBlockReason };
}

/**
 * Presupuesto (HU-11.2): reserva ATÓMICA del cupo del mensaje — cierra el
 * TOCTOU de `checkBudgetForContext` (hallazgo de revisión de seguridad,
 * 2026-07-18, CONFIRMADO en verificación independiente: una ráfaga de
 * requests concurrentes del mismo alumno, o de varios alumnos del mismo
 * tenant, podía leer el mismo contador "viejo" y pasar TODAS el chequeo antes
 * de que ninguna alcanzara a incrementarlo, incurriendo cada una en una
 * llamada real y pagada a OpenRouter). La RPC `tutor_try_reserve_message`
 * (migración `20260719000000_tutor_usage_reserve.sql`) hace chequeo +
 * incremento del contador de MENSAJES en la misma transacción, serializada
 * con un advisory lock por tenant.
 *
 * DEBE llamarse con el cliente de SESIÓN (mismo contrato de identidad que
 * `tutor_add_usage`/`tutor_add_usage_cost`) y SIEMPRE antes de invocar al
 * proveedor de IA. Si `ok:true`, el mensaje YA quedó contado — por eso
 * `persistAssistantMessage` pasa `p_messages: 0` a `tutor_add_usage` (solo
 * reporta tokens/costo, que recién se conocen al terminar el streaming).
 *
 * Límite conocido, documentado (no es un descuido): el presupuesto MENSUAL de
 * tokens no se puede reservar exacto por adelantado (el conteo real de
 * tokens de una respuesta solo se sabe al terminar su streaming) — este
 * mecanismo cierra el conteo de MENSAJES de forma exacta y ACOTA la ventana
 * del presupuesto de tokens al advisory lock (como mucho 1 request en vuelo
 * por tenant cuyo costo aún no se sumó, no una ráfaga sin límite).
 */
export async function reserveBudgetForContext(
  context: TutorContext,
  sessionDb: SupabaseClient,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: TutorBudgetBlockReason }> {
  const today = new Date().toISOString().slice(0, 10);
  const { dailyLimit, monthlyBudget } = await resolveBudgetLimits(context);

  const { data: blockReason, error } = await sessionDb.rpc("tutor_try_reserve_message", {
    p_tenant_id: context.tenantId,
    p_user_id: context.userId,
    p_day: today,
    p_daily_limit: dailyLimit,
    p_monthly_token_budget: monthlyBudget,
  });

  if (error) {
    console.error("[tutor-ia] fallo reservando el cupo de uso (tutor_try_reserve_message)", {
      message: error.message,
    });
    // Fail-closed: un error de infraestructura en la reserva atómica NUNCA
    // debe traducirse en "sin límite" — se bloquea igual que un tope alcanzado.
    return { ok: false, reason: "daily_limit" };
  }
  if (blockReason) return { ok: false, reason: blockReason as TutorBudgetBlockReason };
  return { ok: true };
}

/** Conversación abierta más reciente del alumno para este curso, o una nueva. */
export async function getOrCreateConversation(context: TutorContext): Promise<{ readonly id: string }> {
  const { data: existing } = await context.guard.db
    .from("tutor_conversations")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("enrollment_id", context.enrollmentId)
    .eq("course_id", context.courseId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return { id: existing.id as string };

  const { data: created, error } = await context.guard.db
    .from("tutor_conversations")
    .insert(
      context.guard.withTenant({
        enrollment_id: context.enrollmentId,
        course_id: context.courseId,
        user_id: context.userId,
      }),
    )
    .select("id")
    .single();
  if (error || !created) {
    throw new Error(`getOrCreateConversation: fallo creando la conversación: ${error?.message ?? "sin datos"}`);
  }
  return { id: created.id as string };
}

/** Últimos `limit` mensajes de la conversación, en orden CRONOLÓGICO ascendente. */
export async function loadRecentHistory(
  context: TutorContext,
  conversationId: string,
  limit = 10,
): Promise<TutorPromptHistoryEntry[]> {
  const { data } = await context.guard.db
    .from("tutor_messages")
    .select("role, content")
    .eq("tenant_id", context.tenantId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as { role: "user" | "assistant"; content: string }[])
    .reverse()
    .map((r) => ({ role: r.role, content: r.content }));
}

export async function persistUserMessage(
  context: TutorContext,
  conversationId: string,
  question: string,
): Promise<void> {
  const { error } = await context.guard.db.from("tutor_messages").insert(
    context.guard.withTenant({
      conversation_id: conversationId,
      user_id: context.userId,
      role: "user",
      content: question,
    }),
  );
  if (error) {
    console.error("[tutor-ia] fallo guardando el mensaje del alumno", { message: error.message });
  }
}

export interface TutorAnswerUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsd: number;
}

export interface TutorCitation {
  readonly lessonId: string;
  readonly lessonTitle: string;
}

/**
 * Guarda el mensaje del tutor y reporta el TOKEN/COSTO del turno. `sessionDb`
 * DEBE ser el cliente de SESIÓN (`createSupabaseServerClient()`, sujeto al
 * JWT real) — NUNCA `context.guard.db` (service-role): las RPCs
 * `tutor_add_usage`/`tutor_add_usage_cost` exigen `auth.uid()` real y
 * rechazan cualquier llamada sin sesión (ver la migración
 * `20260717110000_tutor_ia_schema.sql` y `20260718010000_tutor_usage_cost.sql`).
 *
 * ⚠ `p_messages` va SIEMPRE en `0`: el mensaje ya quedó contado por
 * `reserveBudgetForContext` (reserva atómica, llamada ANTES de invocar al
 * proveedor de IA — ver su docstring). Contarlo de nuevo aquí lo duplicaría
 * (un alumno vería su cupo diario consumirse al doble de velocidad real).
 * Esta función solo reporta tokens/costo, que recién se conocen al terminar
 * el streaming.
 *
 * Orden estricto de las 2 RPCs: `tutor_add_usage` SIEMPRE primero (asegura la
 * fila del día vía upsert, aunque ya exista por la reserva); `tutor_add_usage_cost`
 * después (UPDATE puro — si se llamara antes, afectaría 0 filas en silencio).
 *
 * `usage` puede ser `null` (el stream terminó sin chunk de usage, o hubo un
 * error a medio camino): se llaman igual ambas RPCs, con tokens/costo en cero
 * — el mensaje ya fue cobrado en la reserva sin importar lo que pase después
 * (así un fallo de parseo/stream no habilita reintentos gratis).
 */
export async function persistAssistantMessage(
  context: TutorContext,
  sessionDb: SupabaseClient,
  conversationId: string,
  answerText: string,
  citations: readonly TutorCitation[],
  usage: TutorAnswerUsage | null,
): Promise<void> {
  const { error: insertError } = await context.guard.db.from("tutor_messages").insert(
    context.guard.withTenant({
      conversation_id: conversationId,
      user_id: context.userId,
      role: "assistant",
      content: answerText,
      citations,
      input_tokens: usage?.promptTokens ?? null,
      output_tokens: usage?.completionTokens ?? null,
    }),
  );
  if (insertError) {
    console.error("[tutor-ia] fallo guardando la respuesta del tutor", { message: insertError.message });
  }

  const today = new Date().toISOString().slice(0, 10);

  const addUsage = await sessionDb.rpc("tutor_add_usage", {
    p_tenant_id: context.tenantId,
    p_user_id: context.userId,
    p_day: today,
    p_messages: 0,
    p_input_tokens: usage?.promptTokens ?? 0,
    p_output_tokens: usage?.completionTokens ?? 0,
  });
  if (addUsage.error) {
    console.error("[tutor-ia] fallo registrando el uso diario (tutor_add_usage)", {
      message: addUsage.error.message,
    });
  }

  const addCost = await sessionDb.rpc("tutor_add_usage_cost", {
    p_tenant_id: context.tenantId,
    p_user_id: context.userId,
    p_day: today,
    p_cost_usd: usage?.costUsd ?? 0,
  });
  if (addCost.error) {
    console.error("[tutor-ia] fallo registrando el costo diario (tutor_add_usage_cost)", {
      message: addCost.error.message,
    });
  }
}

/** Audita el envío (metadata NO sensible: JAMÁS la pregunta ni la respuesta). */
async function auditTutorMessage(
  context: TutorContext,
  conversationId: string,
  details: { readonly mode: "vector" | "lexical"; readonly citationsCount: number; readonly costUsd: number },
): Promise<void> {
  await writeAudit(context.guard, {
    actorUserId: context.userId,
    action: "tutor.message.sent",
    entity: "tutor_conversation",
    entityId: conversationId,
    details,
  });
}

export interface TutorChatStreamDeps {
  readonly aiClient: AiClient;
  /** Cliente de SESIÓN (ver el comentario de `persistAssistantMessage`). */
  readonly sessionDb: SupabaseClient;
}

export type TutorChatSseEvent =
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "final"; readonly citations: readonly TutorCitation[]; readonly conversationId: string }
  | { readonly type: "error"; readonly error: string };

/**
 * Orquesta un turno completo del chat: conversación → historial → retrieval →
 * prompt → streaming del modelo → persistencia + auditoría. Devuelve un
 * generador de eventos SSE ya normalizados (wire format propio); `route.ts`
 * solo los serializa. Nunca lanza hacia el consumidor: cualquier fallo a
 * medio camino se reporta como `{type:"error"}` DESPUÉS de persistir lo que
 * se alcanzó a generar (mismo criterio que un reintento no debe ser gratis).
 */
export async function* streamTutorAnswer(
  context: TutorContext,
  deps: TutorChatStreamDeps,
  question: string,
): AsyncGenerator<TutorChatSseEvent> {
  const conversation = await getOrCreateConversation(context);
  const history = await loadRecentHistory(context, conversation.id);
  await persistUserMessage(context, conversation.id, question);

  const { fragments, mode } = await searchChunks(context.guard, deps.aiClient, context.courseId, question);

  // Objeto explícito, campo por campo — JAMÁS un spread de `context`: la
  // firma de `buildTutorPrompt` es la lista blanca de minimización (HU-11.3).
  const prompt = buildTutorPrompt({
    courseName: context.courseName,
    firstName: context.firstName,
    fragments,
    aggregateProgress: context.aggregateProgress,
    history,
    question,
  });

  const promptMessages: ChatMessage[] = [{ role: "system", content: prompt.system }, ...prompt.messages];

  let fullText = "";
  let usage: TutorAnswerUsage | null = null;
  let upstreamError = false;

  try {
    for await (const chunk of deps.aiClient.chatStream(promptMessages)) {
      if (chunk.type === "delta" && chunk.text) {
        fullText += chunk.text;
        yield { type: "delta", text: chunk.text };
      } else if (chunk.type === "done") {
        usage = chunk.usage ?? null;
        break;
      } else if (chunk.type === "error") {
        console.error("[tutor-ia] el proveedor de chat reportó un error upstream", { error: chunk.error });
        upstreamError = true;
        break;
      }
    }
  } catch (err) {
    console.error("[tutor-ia] fallo inesperado consumiendo el stream de chat", { message: (err as Error).message });
    upstreamError = true;
  }

  const citations: TutorCitation[] = fullText.length > 0 ? mapCitations(fullText, fragments) : [];

  await persistAssistantMessage(context, deps.sessionDb, conversation.id, fullText, citations, usage);
  await auditTutorMessage(context, conversation.id, {
    mode,
    citationsCount: citations.length,
    costUsd: usage?.costUsd ?? 0,
  });

  if (upstreamError) {
    yield { type: "error", error: "upstream_error" };
    return;
  }
  yield { type: "final", citations, conversationId: conversation.id };
}
