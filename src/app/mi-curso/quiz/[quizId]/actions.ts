"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import {
  saveAnswers,
  startAttempt,
  submitAttempt,
  type AttemptError,
} from "@/modules/evaluacion/attempt-service";
import type { AttemptAnswers } from "@/modules/evaluacion/domain/grading";

export type StartState =
  | { status: "idle" }
  | { status: "error"; error: AttemptError };

/** Inicia un intento (form del alumno). Revalida para mostrar el intento. */
export async function startAttemptAction(
  _prev: StartState,
  formData: FormData,
): Promise<StartState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error", error: "not_enrolled" };
  const quizId = String(formData.get("quizId") ?? "");
  const result = await startAttempt(principal, quizId);
  if (result.ok) {
    revalidatePath(`/mi-curso/quiz/${quizId}`);
    return { status: "idle" };
  }
  return { status: "error", error: result.error };
}

/** Autosave (llamado por el componente cliente durante el intento). */
export async function saveAnswersAction(
  attemptId: string,
  answers: AttemptAnswers,
): Promise<{ ok: boolean }> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false };
  const result = await saveAnswers(principal, attemptId, answers);
  return { ok: result.ok };
}

/** Envía el intento y revalida (muestra el resultado). */
export async function submitAttemptAction(
  quizId: string,
  attemptId: string,
  answers: AttemptAnswers,
): Promise<{ ok: boolean; error?: AttemptError }> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "not_enrolled" };
  const result = await submitAttempt(principal, attemptId, answers);
  if (result.ok) {
    revalidatePath(`/mi-curso/quiz/${quizId}`);
    return { ok: true };
  }
  return { ok: false, error: result.error };
}
