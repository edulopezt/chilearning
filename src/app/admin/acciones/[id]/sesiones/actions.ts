"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import {
  createLiveSession,
  deleteLiveSession,
  updateLiveSession,
  type LiveSessionDeleteResult,
  type LiveSessionMutationResult,
} from "@/modules/academico/live-session-service";

/** Crea una sesión en vivo para la acción (task 5.4). */
export async function createSessionAction(
  _prev: LiveSessionMutationResult | null,
  formData: FormData,
): Promise<LiveSessionMutationResult> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "forbidden" };
  const actionId = String(formData.get("actionId") ?? "");

  const result = await createLiveSession(principal, actionId, {
    title: formData.get("title"),
    provider: formData.get("provider"),
    meetingUrl: formData.get("meetingUrl"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    details: formData.get("details"),
  });
  if (result.ok) revalidatePath(`/admin/acciones/${actionId}/sesiones`);
  return result;
}

/** Edita una sesión en vivo existente. */
export async function updateSessionAction(
  _prev: LiveSessionMutationResult | null,
  formData: FormData,
): Promise<LiveSessionMutationResult> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "forbidden" };
  const actionId = String(formData.get("actionId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");

  const result = await updateLiveSession(principal, sessionId, {
    title: formData.get("title"),
    provider: formData.get("provider"),
    meetingUrl: formData.get("meetingUrl"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    details: formData.get("details"),
  });
  if (result.ok) revalidatePath(`/admin/acciones/${actionId}/sesiones`);
  return result;
}

/** Elimina una sesión SOLO si no tiene asistencia registrada. */
export async function deleteSessionAction(actionId: string, sessionId: string): Promise<LiveSessionDeleteResult> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "forbidden" };
  const result = await deleteLiveSession(principal, sessionId);
  if (result.ok) revalidatePath(`/admin/acciones/${actionId}/sesiones`);
  return result;
}
