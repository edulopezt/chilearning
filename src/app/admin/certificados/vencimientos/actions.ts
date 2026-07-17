"use server";

import { revalidatePath } from "next/cache";

import { updateExpiryConfig, type ExpiryConfigResult } from "@/modules/certificados/expiry-config-service";
import { getPrincipal } from "@/modules/core/auth/session";

/**
 * Server Action de la config de alertas de recertificación (task 5.12, HU-7.3).
 * Los offsets llegan como texto libre ("90, 60, 30"): se parten aquí y el
 * dominio (`sanitizeOffsets`) los valida, deduplica y ordena.
 */
export async function updateExpiryConfigAction(
  _prev: ExpiryConfigResult | null,
  formData: FormData,
): Promise<ExpiryConfigResult> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "forbidden" };

  const offsetsDays = String(formData.get("offsetsDays") ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const result = await updateExpiryConfig(principal, {
    offsetsDays,
    enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
  });
  if (result.ok) revalidatePath("/admin/certificados/vencimientos");
  return result;
}
