"use server";

import { revalidatePath } from "next/cache";

import { setLessonProgress } from "@/modules/academico/progress-service";
import { getPrincipal } from "@/modules/core/auth/session";

/** Marca/desmarca una lección como completada para el alumno (task 1.5). */
export async function setLessonProgressAction(lessonId: string, completed: boolean): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  await setLessonProgress(principal, lessonId, completed);
  revalidatePath("/mi-curso");
}
