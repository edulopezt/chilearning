"use server";

import { revalidatePath } from "next/cache";

import { createAction, type ActionMutationResult } from "@/modules/academico/action-service";
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
