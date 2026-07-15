"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import {
  markGuideSent,
  sendClaveUnicaGuide,
  type GuideError,
  type GuideSendSummary,
} from "@/modules/comunicacion/guide-service";

export type GuideActionState =
  | { status: "idle" }
  | { status: "error"; error: GuideError }
  | { status: "sent"; summary: GuideSendSummary; audited: boolean }
  | { status: "marked" };

/** Envía la guía Clave Única a los inscritos no exentos de la acción. */
export async function sendGuideAction(
  _prev: GuideActionState,
  formData: FormData,
): Promise<GuideActionState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error", error: "forbidden" };
  const actionId = String(formData.get("actionId") ?? "");
  if (!actionId) return { status: "error", error: "not_found" };

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const courseUrl = host ? `${proto}://${host}/mi-curso` : undefined;

  const result = await sendClaveUnicaGuide(principal, actionId, { courseUrl });
  if (!result.ok) return { status: "error", error: result.error };
  revalidatePath(`/admin/acciones/${actionId}/preflight`);
  return { status: "sent", summary: result.summary, audited: result.audited };
}

/** Marca manual (fallback sin proveedor de correo). */
export async function markGuideSentAction(
  _prev: GuideActionState,
  formData: FormData,
): Promise<GuideActionState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error", error: "forbidden" };
  const actionId = String(formData.get("actionId") ?? "");
  if (!actionId) return { status: "error", error: "not_found" };

  const result = await markGuideSent(principal, actionId);
  if (!result.ok) return { status: "error", error: result.error };
  revalidatePath(`/admin/acciones/${actionId}/preflight`);
  return { status: "marked" };
}
