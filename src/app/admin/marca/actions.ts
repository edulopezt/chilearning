"use server";

import { revalidatePath } from "next/cache";

import { saveBranding, type SaveBrandingResult } from "@/modules/core/branding-service";
import { getPrincipal } from "@/modules/core/auth/session";

/** Server Action del editor de marca (task 1.10). */
export async function saveBrandingAction(
  _prev: SaveBrandingResult | null,
  formData: FormData,
): Promise<SaveBrandingResult> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "forbidden" };

  const result = await saveBranding(principal, {
    primaryColor: String(formData.get("primaryColor") ?? ""),
    accentColor: String(formData.get("accentColor") ?? ""),
    logoUrl: String(formData.get("logoUrl") ?? ""),
    name: String(formData.get("name") ?? ""),
    rut: String(formData.get("rut") ?? ""),
  });

  if (result.ok) revalidatePath("/admin/marca");
  return result;
}
