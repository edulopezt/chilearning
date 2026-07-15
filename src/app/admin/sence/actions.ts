"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { saveSenceConfig, type SaveResult } from "@/modules/core/sence-config";

/** Server Action del formulario de configuración SENCE (task 1.2). */
export async function saveSenceConfigAction(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "forbidden" };

  const environment = String(formData.get("environment") ?? "rcetest");
  const result = await saveSenceConfig(principal, {
    rutOtec: String(formData.get("rutOtec") ?? ""),
    token: String(formData.get("token") ?? ""),
    environment: environment === "rce" ? "rce" : "rcetest",
  });

  if (result.ok) revalidatePath("/admin/sence");
  return result;
}
