"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { setCourseTutorConfig } from "@/modules/tutor-ia/tutor-admin-service";

/** Server Action del panel admin del Tutor IA (task 5.8b). */
export async function saveCourseTutorConfigAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;

  const courseId = String(formData.get("courseId") ?? "");
  const enabled = formData.get("enabled") === "on";
  const rawLimit = String(formData.get("dailyMessageLimit") ?? "").trim();
  const dailyMessageLimit = rawLimit.length > 0 && Number.isFinite(Number(rawLimit)) ? Number(rawLimit) : null;

  await setCourseTutorConfig(principal, courseId, { enabled, dailyMessageLimit });
  revalidatePath("/admin/tutor-ia");
}
