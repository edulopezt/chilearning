"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { getSubmissionDownloadUrl } from "@/modules/evaluacion/assignment-service";
import {
  publishGrade,
  saveDraftGrade,
  updatePublishedGrade,
  type GradingResult,
} from "@/modules/evaluacion/grading-service";
import { emailSenderFromEnv } from "@/modules/comunicacion/email-sender";

export type GradeState =
  | { status: "idle" }
  | { status: "draft" }
  | { status: "published" }
  | { status: "error"; error: string }
  | { status: "invalid"; errors: { field: string; message: string }[] };

function toState(result: GradingResult, published: boolean): GradeState {
  if (result.ok) return { status: published ? "published" : "draft" };
  if ("validation" in result) return { status: "invalid", errors: result.validation };
  return { status: "error", error: result.error };
}

function readGrade(formData: FormData): { directGrade: number; feedback: string } {
  return {
    directGrade: Number(formData.get("grade") ?? 0),
    feedback: String(formData.get("feedback") ?? ""),
  };
}

export async function saveDraftGradeAction(
  _prev: GradeState,
  formData: FormData,
): Promise<GradeState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error", error: "forbidden" };
  const submissionId = String(formData.get("submissionId") ?? "");
  const actionId = String(formData.get("actionId") ?? "");
  const result = await saveDraftGrade(principal, submissionId, readGrade(formData));
  if (result.ok) revalidatePath(`/tablero/entregas/${actionId}`);
  return toState(result, false);
}

export async function publishGradeAction(
  _prev: GradeState,
  formData: FormData,
): Promise<GradeState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error", error: "forbidden" };
  const submissionId = String(formData.get("submissionId") ?? "");
  const actionId = String(formData.get("actionId") ?? "");
  const result = await publishGrade(principal, submissionId, readGrade(formData), {
    emailSender: emailSenderFromEnv(process.env),
  });
  if (result.ok) revalidatePath(`/tablero/entregas/${actionId}`);
  return toState(result, true);
}

/** Editar una nota YA publicada (exige motivo — el gate del hito). */
export async function updateGradeAction(
  _prev: GradeState,
  formData: FormData,
): Promise<GradeState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error", error: "forbidden" };
  const gradeId = String(formData.get("gradeId") ?? "");
  const actionId = String(formData.get("actionId") ?? "");
  const result = await updatePublishedGrade(principal, gradeId, {
    ...readGrade(formData),
    motivo: String(formData.get("motivo") ?? "") || null,
  });
  if (result.ok) revalidatePath(`/tablero/entregas/${actionId}`);
  return toState(result, true);
}

export async function downloadSubmissionAction(submissionId: string): Promise<string | null> {
  const principal = await getPrincipal();
  if (!principal) return null;
  const result = await getSubmissionDownloadUrl(principal, submissionId);
  return result.ok ? result.url : null;
}
