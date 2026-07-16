"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { ensureChecklist, setDjState } from "@/modules/dj/dj-service";
import { DJ_STATES, type DjState } from "@/modules/dj/domain/state-machine";

export async function ensureChecklistAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const actionId = String(formData.get("actionId") ?? "");
  await ensureChecklist(principal, actionId);
  revalidatePath(`/admin/acciones/${actionId}/dj`);
}

export async function setDjStateAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const actionId = String(formData.get("actionId") ?? "");
  const checklistId = String(formData.get("checklistId") ?? "");
  const next = String(formData.get("state") ?? "") as DjState;
  if (!DJ_STATES.includes(next)) return;
  await setDjState(principal, checklistId, next, String(formData.get("notes") ?? "") || undefined);
  revalidatePath(`/admin/acciones/${actionId}/dj`);
}
