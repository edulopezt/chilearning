import "server-only";

import { tenantGuard } from "@/lib/tenant-guard";
import type { Principal } from "@/modules/core/domain/rbac";

/**
 * Progreso del alumno (task 1.5). El alumno marca lecciones como completadas.
 * La escritura verifica que la inscripción sea SUYA (no basta el tenant) y va
 * por service-role bajo tenantGuard. El cliente nunca escribe directo.
 */

export type ProgressError = "no_tenant" | "not_enrolled" | "lesson_not_found";
export type ProgressResult = { ok: true } | { ok: false; error: ProgressError };

/** ids de lecciones completadas por la inscripción (para la vista del curso). */
export async function completedLessonIds(principal: Principal, enrollmentId: string): Promise<Set<string>> {
  if (!principal.tenantId) return new Set();
  const guard = tenantGuard(principal.tenantId);
  const { data } = await guard.db
    .from("lesson_progress")
    .select("lesson_id")
    .eq("tenant_id", principal.tenantId)
    .eq("enrollment_id", enrollmentId)
    .eq("completed", true);
  return new Set((data ?? []).map((r) => r.lesson_id as string));
}

/**
 * Marca (o desmarca) una lección como completada para el alumno actual.
 * Resuelve la inscripción del alumno a partir del curso de la lección.
 */
export async function setLessonProgress(
  principal: Principal,
  lessonId: string,
  completed: boolean,
): Promise<ProgressResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  const guard = tenantGuard(principal.tenantId);

  const { data: lesson } = await guard.db
    .from("lessons")
    .select("id, course_id")
    .eq("id", lessonId)
    .eq("tenant_id", principal.tenantId)
    .maybeSingle();
  if (!lesson) return { ok: false, error: "lesson_not_found" };

  // La inscripción del alumno cuya acción pertenece al curso de la lección.
  const { data: actions } = await guard.db
    .from("actions")
    .select("id")
    .eq("course_id", lesson.course_id)
    .eq("tenant_id", principal.tenantId);
  const actionIds = (actions ?? []).map((a) => a.id as string);
  if (actionIds.length === 0) return { ok: false, error: "not_enrolled" };

  const { data: enrollment } = await guard.db
    .from("enrollments")
    .select("id")
    .eq("tenant_id", principal.tenantId)
    .eq("user_id", principal.userId)
    .in("action_id", actionIds)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!enrollment) return { ok: false, error: "not_enrolled" };

  const { error } = await guard.db.from("lesson_progress").upsert(
    guard.withTenant({
      enrollment_id: enrollment.id,
      lesson_id: lessonId,
      completed,
      completed_at: completed ? new Date().toISOString() : null,
    }),
    { onConflict: "enrollment_id,lesson_id" },
  );
  if (error) return { ok: false, error: "not_enrolled" };
  return { ok: true };
}
