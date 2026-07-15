"use server";

import { revalidatePath } from "next/cache";

import {
  createLesson,
  deleteLesson,
  moveLesson,
  updateLesson,
  type LessonMutationResult,
} from "@/modules/academico/lesson-service";
import { getPrincipal } from "@/modules/core/auth/session";

/** Server Actions del constructor de lecciones (task 1.4). */

export async function createLessonAction(
  courseId: string,
  _prev: LessonMutationResult | null,
  formData: FormData,
): Promise<LessonMutationResult> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "forbidden" };
  const result = await createLesson(principal, courseId, {
    title: formData.get("title"),
    kind: formData.get("kind"),
    content: formData.get("content"),
    status: formData.get("status"),
  });
  if (result.ok) revalidatePath(`/admin/cursos/${courseId}/lecciones`);
  return result;
}

async function withPrincipal<T>(fn: (p: NonNullable<Awaited<ReturnType<typeof getPrincipal>>>) => Promise<T>) {
  const principal = await getPrincipal();
  if (!principal) return null;
  return fn(principal);
}

export async function moveLessonAction(courseId: string, lessonId: string, direction: "up" | "down") {
  await withPrincipal((p) => moveLesson(p, lessonId, direction));
  revalidatePath(`/admin/cursos/${courseId}/lecciones`);
}

export async function togglePublishAction(
  courseId: string,
  lessonId: string,
  next: "draft" | "published",
  title: string,
  kind: string,
  content: string,
) {
  await withPrincipal((p) => updateLesson(p, lessonId, { title, kind, content, status: next }));
  revalidatePath(`/admin/cursos/${courseId}/lecciones`);
}

export async function deleteLessonAction(courseId: string, lessonId: string) {
  await withPrincipal((p) => deleteLesson(p, lessonId));
  revalidatePath(`/admin/cursos/${courseId}/lecciones`);
}
