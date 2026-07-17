"use server";

import { revalidatePath } from "next/cache";

import { createLesson } from "@/modules/academico/lesson-service";
import { deleteScormPackage, retryScormPackage, uploadScormPackage } from "@/modules/contenido/scorm-service";
import { getPrincipal } from "@/modules/core/auth/session";

/** Server Actions de la ingesta SCORM (task 5.1a). */

export type ScormUploadState = { status: "idle" } | { status: "ok" } | { status: "file" } | { status: "error" };

export async function uploadScormAction(
  courseId: string,
  _prev: ScormUploadState,
  formData: FormData,
): Promise<ScormUploadState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error" };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "file" };
  const bytes = await file.arrayBuffer();
  const result = await uploadScormPackage(principal, courseId, {
    title: String(formData.get("title") ?? ""),
    file: { name: file.name, type: file.type, size: file.size, bytes },
  });
  if (result.ok) {
    revalidatePath(`/admin/cursos/${courseId}/scorm`);
    return { status: "ok" };
  }
  return { status: result.error === "invalid" ? "file" : "error" };
}

export async function retryScormAction(courseId: string, packageId: string): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  await retryScormPackage(principal, packageId);
  revalidatePath(`/admin/cursos/${courseId}/scorm`);
}

export async function deleteScormAction(courseId: string, packageId: string): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  await deleteScormPackage(principal, packageId);
  revalidatePath(`/admin/cursos/${courseId}/scorm`);
}

/** Crea la lección `kind=scorm` que referencia el paquete (ya `ready`) — reusa `createLesson`. */
export async function createScormLessonAction(courseId: string, packageId: string, title: string): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  await createLesson(principal, courseId, { title, kind: "scorm", content: packageId, status: "draft" });
  revalidatePath(`/admin/cursos/${courseId}/lecciones`);
  revalidatePath(`/admin/cursos/${courseId}/scorm`);
}
