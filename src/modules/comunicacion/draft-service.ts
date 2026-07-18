import "server-only";

import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { stripPIIForDraft } from "@/modules/comunicacion/domain/pii-strip";
import { buildDraftPrompt } from "@/modules/comunicacion/domain/draft-prompt";
import { getThread as getMessageThread } from "@/modules/comunicacion/message-service";
import { getThread as getForumThread } from "@/modules/comunicacion/forum-service";
import { aiClientFromEnv } from "@/modules/tutor-ia/ai-client";
import { searchChunks } from "@/modules/tutor-ia/retrieval";

/**
 * Borrador de respuesta generado por IA para staff (task 5.9, HU-9.5):
 * "recibo un borrador de respuesta generado por IA para cada consulta del
 * foro/mensajería, que reviso, edito y envío (human-in-the-loop: nada se
 * envía solo)". CA: "los borradores IA se generan con la consulta + contenido
 * del curso, sin datos identificatorios del alumno".
 *
 * EFÍMERO A PROPÓSITO: no se persiste en ninguna tabla. Se muestra solo en el
 * navegador de quien lo pidió (rellena el `<textarea>` del formulario
 * existente); si el relator no lo usa, desaparece. Human-in-the-loop por
 * construcción, no por convención — nada sale al alumno desde aquí.
 */

const STAFF_ROLES = ["otec_admin", "coordinator", "instructor", "tutor"] as const;

export type DraftSurface = "message" | "forum";

export type DraftResult =
  | { readonly ok: true; readonly draft: string }
  | { readonly ok: false; readonly error: "forbidden" | "not_configured" | "not_found" | "upstream_error" };

interface LastStudentQuestion {
  readonly body: string;
  readonly courseId: string;
}

/**
 * Última pregunta DEL ALUMNO (nunca de staff) en el hilo, + el curso al que
 * pertenece. `getThread` de cada servicio ya validó que `principal` tiene
 * acceso (staff del tenant, en este caso) — aquí solo se recorre lo ya
 * autorizado.
 */
async function lastStudentQuestion(
  principal: Principal,
  surface: DraftSurface,
  tenantId: string,
  threadId: string,
): Promise<LastStudentQuestion | null> {
  if (surface === "message") {
    const view = await getMessageThread(principal, threadId);
    if (!view) return null;
    const last = [...view.messages].reverse().find((m) => !m.senderIsStaff);
    if (!last) return null;
    return { body: last.body, courseId: view.thread.courseId };
  }

  const view = await getForumThread(principal, threadId);
  if (!view) return null;
  const last = [...view.posts].reverse().find((p) => !p.fromStaff);
  if (!last) return null;

  // `ForumThread` no expone `courseId` (solo lo usa internamente el servicio
  // para el chequeo de acceso) — se resuelve aparte, ya con el acceso
  // VALIDADO arriba por `getThread`.
  const guard = tenantGuard(tenantId);
  const { data } = await guard.db
    .from("forum_threads")
    .select("course_id")
    .eq("tenant_id", tenantId)
    .eq("id", threadId)
    .maybeSingle();
  if (!data) return null;
  return { body: last.body, courseId: data.course_id as string };
}

/**
 * Genera el borrador. Gate de rol + `aiClient.configured` son la defensa del
 * ENDPOINT — la página server-component debe ADEMÁS chequear `configured`
 * antes de renderizar el botón (no es la única defensa, es la primera capa).
 */
export async function generateReplyDraft(
  principal: Principal,
  surface: DraftSurface,
  threadId: string,
): Promise<DraftResult> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, STAFF_ROLES)) {
    return { ok: false, error: "forbidden" };
  }
  const tenantId = principal.tenantId;

  const aiClient = aiClientFromEnv(process.env);
  if (!aiClient.configured) return { ok: false, error: "not_configured" };

  const found = await lastStudentQuestion(principal, surface, tenantId, threadId);
  if (!found) return { ok: false, error: "not_found" };

  const question = stripPIIForDraft(found.body);
  const guard = tenantGuard(tenantId);
  const { fragments } = await searchChunks(guard, aiClient, found.courseId, question);
  const { system, messages } = buildDraftPrompt({ question, fragments });

  const result = await aiClient.complete([{ role: "system", content: system }, ...messages]);
  if (!result.ok) return { ok: false, error: "upstream_error" };
  return { ok: true, draft: result.text };
}
