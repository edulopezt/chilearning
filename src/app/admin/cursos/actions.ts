"use server";

import { revalidatePath } from "next/cache";

import { createCourse, type MutationResult } from "@/modules/academico/course-service";
import { getPrincipal } from "@/modules/core/auth/session";

/** Server Action para crear un curso (task 1.1). */
export async function createCourseAction(
  _prev: MutationResult | null,
  formData: FormData,
): Promise<MutationResult> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "forbidden" };

  const result = await createCourse(principal, {
    name: formData.get("name"),
    modality: formData.get("modality"),
    hours: formData.get("hours"),
    sence: formData.get("sence"),
    codSence: formData.get("codSence"),
    status: formData.get("status"),
    completionRules: {
      requireAllLessons: formData.get("requireAllLessons"),
      requireSurvey: formData.get("requireSurvey"),
      minAttendancePct: formData.get("minAttendancePct"),
    },
  });

  if (result.ok) revalidatePath("/admin/cursos");
  return result;
}
