"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import {
  createQuestion,
  createQuiz,
  deleteQuestion,
  deleteQuiz,
  publishQuiz,
  updateQuestion,
  updateQuiz,
  type QuizMutationResult,
} from "@/modules/evaluacion/quiz-service";

export type QuizActionState =
  | { status: "idle" }
  | { status: "ok"; id: string }
  | { status: "error"; error: string }
  | { status: "invalid"; errors: { field: string; message: string }[] };

function toState(result: QuizMutationResult): QuizActionState {
  if (result.ok) return { status: "ok", id: result.id };
  if ("validation" in result) return { status: "invalid", errors: result.validation };
  return { status: "error", error: result.error };
}

function readQuizForm(formData: FormData): Record<string, unknown> {
  const numOrNull = (v: FormDataEntryValue | null): unknown => {
    const s = String(v ?? "").trim();
    return s === "" ? null : Number(s);
  };
  return {
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    timeLimitMinutes: numOrNull(formData.get("timeLimitMinutes")),
    maxAttempts: numOrNull(formData.get("maxAttempts")),
    attemptScoring: formData.get("attemptScoring") ?? "best",
    passingPct: Number(formData.get("passingPct") ?? 60),
    poolSize: numOrNull(formData.get("poolSize")),
    shuffleQuestions: formData.get("shuffleQuestions") === "on",
    shuffleChoices: formData.get("shuffleChoices") === "on",
    reviewPolicy: formData.get("reviewPolicy") ?? "after_submit",
    weight: Number(formData.get("weight") ?? 1),
  };
}

export async function createQuizAction(
  _prev: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error", error: "forbidden" };
  const courseId = String(formData.get("courseId") ?? "");
  const result = await createQuiz(principal, courseId, readQuizForm(formData));
  if (result.ok) revalidatePath(`/admin/cursos/${courseId}/evaluaciones`);
  return toState(result);
}

export async function updateQuizAction(
  _prev: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error", error: "forbidden" };
  const quizId = String(formData.get("quizId") ?? "");
  const courseId = String(formData.get("courseId") ?? "");
  const result = await updateQuiz(principal, quizId, readQuizForm(formData));
  if (result.ok) revalidatePath(`/admin/cursos/${courseId}/evaluaciones/quiz/${quizId}`);
  return toState(result);
}

export async function publishQuizAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const quizId = String(formData.get("quizId") ?? "");
  const courseId = String(formData.get("courseId") ?? "");
  const publish = formData.get("publish") === "true";
  await publishQuiz(principal, quizId, publish);
  revalidatePath(`/admin/cursos/${courseId}/evaluaciones`);
  revalidatePath(`/admin/cursos/${courseId}/evaluaciones/quiz/${quizId}`);
}

export async function deleteQuizAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const quizId = String(formData.get("quizId") ?? "");
  const courseId = String(formData.get("courseId") ?? "");
  await deleteQuiz(principal, quizId);
  revalidatePath(`/admin/cursos/${courseId}/evaluaciones`);
}

/** Lee el body de una pregunta desde el JSON serializado por el form cliente. */
function readQuestionForm(formData: FormData): Record<string, unknown> {
  const kind = String(formData.get("kind") ?? "");
  const base = {
    kind,
    prompt: formData.get("prompt"),
    points: Number(formData.get("points") ?? 1),
  };
  const bodyJson = String(formData.get("body") ?? "{}");
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(bodyJson) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { ...base, ...body };
}

export async function createQuestionAction(
  _prev: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error", error: "forbidden" };
  const quizId = String(formData.get("quizId") ?? "");
  const courseId = String(formData.get("courseId") ?? "");
  const result = await createQuestion(principal, quizId, readQuestionForm(formData));
  if (result.ok) revalidatePath(`/admin/cursos/${courseId}/evaluaciones/quiz/${quizId}`);
  return toState(result);
}

export async function updateQuestionAction(
  _prev: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error", error: "forbidden" };
  const questionId = String(formData.get("questionId") ?? "");
  const quizId = String(formData.get("quizId") ?? "");
  const courseId = String(formData.get("courseId") ?? "");
  const result = await updateQuestion(principal, questionId, readQuestionForm(formData));
  if (result.ok) revalidatePath(`/admin/cursos/${courseId}/evaluaciones/quiz/${quizId}`);
  return toState(result);
}

export async function deleteQuestionAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const questionId = String(formData.get("questionId") ?? "");
  const quizId = String(formData.get("quizId") ?? "");
  const courseId = String(formData.get("courseId") ?? "");
  await deleteQuestion(principal, questionId);
  revalidatePath(`/admin/cursos/${courseId}/evaluaciones/quiz/${quizId}`);
}
