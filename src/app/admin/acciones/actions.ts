"use server";

import { revalidatePath } from "next/cache";

import {
  createAction,
  reexecuteAction,
  scheduleAndActivate,
  type ActionMutationResult,
} from "@/modules/academico/action-service";
import { getPrincipal } from "@/modules/core/auth/session";

/** Server Action para crear una acción SENCE (task 1.2). */
export async function createActionAction(
  _prev: ActionMutationResult | null,
  formData: FormData,
): Promise<ActionMutationResult> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "forbidden" };

  const result = await createAction(principal, {
    courseId: formData.get("courseId"),
    codigoAccion: formData.get("codigoAccion"),
    trainingLine: formData.get("trainingLine"),
    environment: formData.get("environment"),
    attendanceLock: formData.get("attendanceLock"),
    startsOn: formData.get("startsOn"),
    endsOn: formData.get("endsOn"),
  });

  if (result.ok) revalidatePath("/admin/acciones");
  return result;
}

/** Re-ejecuta una acción (task 2.8): crea una copia en borrador, sin inscritos. */
export async function reexecuteActionAction(actionId: string): Promise<ActionMutationResult> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "forbidden" };
  const result = await reexecuteAction(principal, actionId);
  if (result.ok) revalidatePath("/admin/acciones");
  return result;
}

/** Fija código + fechas de un borrador y lo activa (task 2.8, form de activación). */
export async function activateWithScheduleAction(
  _prev: ActionMutationResult | null,
  formData: FormData,
): Promise<ActionMutationResult> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "forbidden" };
  const actionId = String(formData.get("actionId") ?? "");
  const result = await scheduleAndActivate(principal, actionId, {
    codigoAccion: formData.get("codigoAccion"),
    startsOn: formData.get("startsOn"),
    endsOn: formData.get("endsOn"),
  });
  if (result.ok) revalidatePath("/admin/acciones");
  return result;
}
