"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { markAttendance, type AttendanceWriteResult } from "@/modules/academico/live-session-service";

/** Marca la asistencia (manual, staff) de un inscrito en la sesión. */
export async function markAttendanceAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const actionId = String(formData.get("actionId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  const enrollmentId = String(formData.get("enrollmentId") ?? "");
  const present = formData.get("present") === "true";
  const note = String(formData.get("note") ?? "");

  const result: AttendanceWriteResult = await markAttendance(principal, sessionId, enrollmentId, present, note);
  if (result.ok) revalidatePath(`/admin/acciones/${actionId}/sesiones/${sessionId}`);
}
