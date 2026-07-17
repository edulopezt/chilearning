"use server";

import { revalidatePath } from "next/cache";

import { cloneCourse, createCourse, type MutationResult } from "@/modules/academico/course-service";
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
    validityMonths: formData.get("validityMonths"),
    completionRules: {
      requireAllLessons: formData.get("requireAllLessons"),
      requireSurvey: formData.get("requireSurvey"),
      minAttendancePct: formData.get("minAttendancePct"),
    },
  });

  if (result.ok) revalidatePath("/admin/cursos");
  return result;
}

/** Server Action para clonar un curso completo (task 2.8): copia en borrador. */
export async function cloneCourseAction(courseId: string): Promise<MutationResult> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "forbidden" };
  const result = await cloneCourse(principal, courseId);
  if (result.ok) revalidatePath("/admin/cursos");
  return result;
}
