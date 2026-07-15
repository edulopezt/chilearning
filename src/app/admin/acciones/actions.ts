"use server";

import { revalidatePath } from "next/cache";

import {
  activateAction,
  createAction,
  reexecuteAction,
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

/** Activa una acción (task 2.8): exige fechas y código nuevo si es re-ejecución. */
export async function activateActionAction(actionId: string): Promise<ActionMutationResult> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "forbidden" };
  const result = await activateAction(principal, actionId);
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
