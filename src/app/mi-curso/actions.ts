"use server";

import { revalidatePath } from "next/cache";

import { setLessonProgress } from "@/modules/academico/progress-service";
import { selfMarkAttendance, type SelfMarkResult } from "@/modules/academico/live-session-service";
import { getPrincipal } from "@/modules/core/auth/session";

/** Marca/desmarca una lección como completada para el alumno (task 1.5). */
export async function setLessonProgressAction(lessonId: string, completed: boolean): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  await setLessonProgress(principal, lessonId, completed);
  revalidatePath("/mi-curso");
}

/**
 * Auto-marca de asistencia INTERNA de una sesión en vivo (task 5.4, spec
 * §7-R3) — no es registro SENCE, no afecta el candado de contenido.
 */
export async function selfMarkAttendanceAction(sessionId: string): Promise<SelfMarkResult> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "no_tenant" };
  const result = await selfMarkAttendance(principal, sessionId);
  if (result.ok) revalidatePath("/mi-curso");
  return result;
}
