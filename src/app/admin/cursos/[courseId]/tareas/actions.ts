"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import {
  createAssignment,
  publishAssignment,
  type AssignmentMutationResult,
} from "@/modules/evaluacion/assignment-service";

export type AssignmentActionState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error" }
  | { status: "invalid"; errors: { field: string; message: string }[] };

function toState(result: AssignmentMutationResult): AssignmentActionState {
  if (result.ok) return { status: "ok" };
  if ("validation" in result) return { status: "invalid", errors: result.validation };
  return { status: "error" };
}

export async function createAssignmentAction(
  _prev: AssignmentActionState,
  formData: FormData,
): Promise<AssignmentActionState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error" };
  const courseId = String(formData.get("courseId") ?? "");
  const dueRaw = String(formData.get("dueAt") ?? "").trim();
  const result = await createAssignment(principal, courseId, {
    title: formData.get("title"),
    instructions: formData.get("instructions") ?? "",
    // datetime-local → ISO; vacío = sin plazo.
    dueAt: dueRaw === "" ? null : new Date(dueRaw).toISOString(),
    graceHours: Number(formData.get("graceHours") ?? 0),
    passingPct: Number(formData.get("passingPct") ?? 60),
    weight: Number(formData.get("weight") ?? 1),
  });
  if (result.ok) revalidatePath(`/admin/cursos/${courseId}/tareas`);
  return toState(result);
}

export async function publishAssignmentAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const courseId = String(formData.get("courseId") ?? "");
  await publishAssignment(principal, assignmentId, formData.get("publish") === "true");
  revalidatePath(`/admin/cursos/${courseId}/tareas`);
}
