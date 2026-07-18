"use server";

import { esCL } from "@/i18n/es-CL";
import { startThread } from "@/modules/comunicacion/message-service";
import { getPrincipal } from "@/modules/core/auth/session";
import { resolveTutorContext } from "@/modules/tutor-ia/tutor-chat-service";

export type DeriveToHumanResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * Deriva a un tutor humano (task 5.8b, HU-11.3): toma SOLO la ÚLTIMA pregunta
 * del alumno (nunca la respuesta de la IA ni el historial completo) y abre un
 * hilo de mensajería con ella.
 */
export async function deriveToHumanAction(question: string): Promise<DeriveToHumanResult> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "unauthorized" };

  const gate = await resolveTutorContext(principal);
  if (!gate.ok) return { ok: false, error: gate.reason };

  const trimmed = question.trim();
  if (trimmed.length === 0) return { ok: false, error: "no_question" };

  const result = await startThread(principal, gate.context.courseId, {
    subject: esCL.tutorIA.deriveSubject,
    body: trimmed,
  });
  if (!result.ok) return { ok: false, error: "generic" };
  return { ok: true };
}
