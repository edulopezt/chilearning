"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { createSurvey, publishSurvey, type SurveyWriteResult } from "@/modules/evaluacion/survey-service";

export type SurveyActionState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error" }
  | { status: "invalid"; errors: { field: string; message: string }[] };

function toState(result: SurveyWriteResult): SurveyActionState {
  if (result.ok) return { status: "ok" };
  if (result.error === "invalid") return { status: "invalid", errors: result.errors ?? [] };
  return { status: "error" };
}

function parseQuestions(raw: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function createSurveyAction(
  _prev: SurveyActionState,
  formData: FormData,
): Promise<SurveyActionState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error" };
  const courseId = String(formData.get("courseId") ?? "");
  const result = await createSurvey(principal, courseId, {
    title: formData.get("title"),
    intro: formData.get("intro") ?? "",
    anonymous: formData.get("anonymous") === "on" || formData.get("anonymous") === "true",
    questions: parseQuestions(String(formData.get("questions") ?? "[]")),
  });
  if (result.ok) revalidatePath(`/admin/cursos/${courseId}/encuesta`);
  return toState(result);
}

export async function publishSurveyAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const surveyId = String(formData.get("surveyId") ?? "");
  const courseId = String(formData.get("courseId") ?? "");
  await publishSurvey(principal, surveyId, formData.get("publish") === "true");
  revalidatePath(`/admin/cursos/${courseId}/encuesta`);
}
