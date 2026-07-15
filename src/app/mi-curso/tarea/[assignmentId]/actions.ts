"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import {
  getSubmissionDownloadUrl,
  submitAssignment,
  type AssignmentError,
} from "@/modules/evaluacion/assignment-service";

export type SubmitState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error"; error: AssignmentError };

/** Entrega del alumno: lee el File del FormData y sube sus bytes al bucket. */
export async function submitAssignmentAction(
  _prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error", error: "not_enrolled" };
  const assignmentId = String(formData.get("assignmentId") ?? "");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", error: "file_rejected" };
  }
  const bytes = await file.arrayBuffer();
  const result = await submitAssignment(principal, assignmentId, {
    file: { name: file.name, size: file.size, type: file.type, bytes },
    comment: String(formData.get("comment") ?? ""),
  });
  if (result.ok) {
    revalidatePath(`/mi-curso/tarea/${assignmentId}`);
    return { status: "ok" };
  }
  return { status: "error", error: result.error };
}

/** Devuelve la signed URL de descarga de una entrega propia. */
export async function downloadSubmissionAction(submissionId: string): Promise<string | null> {
  const principal = await getPrincipal();
  if (!principal) return null;
  const result = await getSubmissionDownloadUrl(principal, submissionId);
  return result.ok ? result.url : null;
}
