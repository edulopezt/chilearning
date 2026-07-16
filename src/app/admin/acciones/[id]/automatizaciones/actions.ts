"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { setAutomationConfig } from "@/modules/comunicacion/automation-service";

export async function setAutomationAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const actionId = String(formData.get("actionId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const enabled = formData.get("enabled") === "on";
  const inactiveDaysRaw = String(formData.get("inactiveDays") ?? "").trim();
  const settings = inactiveDaysRaw ? { inactiveDays: Number(inactiveDaysRaw) } : {};
  await setAutomationConfig(principal, actionId, kind, enabled, settings);
  revalidatePath(`/admin/acciones/${actionId}/automatizaciones`);
}
