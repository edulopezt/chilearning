"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { setMyOptOut } from "@/modules/comunicacion/automation-service";

export async function toggleOptOutAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const channel = String(formData.get("channel") ?? "");
  const optedOut = String(formData.get("optedOut") ?? "") === "true";
  await setMyOptOut(principal, channel, optedOut);
  revalidatePath("/preferencias");
}
