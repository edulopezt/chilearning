"use server";

import { getPrincipal } from "@/modules/core/auth/session";
import { submitSurvey } from "@/modules/evaluacion/survey-service";

export type StudentSurveyState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "invalid" }
  | { status: "notavailable" }
  | { status: "error" };

function parseAnswers(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function submitSurveyAction(
  _prev: StudentSurveyState,
  formData: FormData,
): Promise<StudentSurveyState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error" };
  const surveyId = String(formData.get("surveyId") ?? "");
  const answers = parseAnswers(String(formData.get("answers") ?? "{}"));

  const result = await submitSurvey(principal, surveyId, answers);
  if (result.ok) return { status: "ok" };
  if (result.error === "already_submitted") return { status: "ok" };
  if (result.error === "invalid") return { status: "invalid" };
  return { status: "notavailable" };
}
