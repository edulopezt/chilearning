import "server-only";

import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { parseLessonInput, type LessonFieldError, type LessonInput } from "@/modules/academico/domain/lesson";

/**
 * Constructor de lecciones (task 1.4). CRUD + reordenar vía service-role bajo
 * tenantGuard, autorizado a otec_admin/coordinator. La lección se cuelga de un
 * curso del tenant (aislamiento verificado por el filtro explícito).
 */

export interface LessonRow {
  id: string;
  course_id: string;
  title: string;
  kind: string;
  content: string;
  position: number;
  status: string;
}

export type LessonServiceError = "forbidden" | "no_tenant" | "not_found" | "course_not_found";
export type LessonMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: LessonServiceError }
  | { ok: false; validation: LessonFieldError[] };

const MANAGERS = ["otec_admin", "coordinator"] as const;

function canManage(p: Principal): boolean {
  return Boolean(p.tenantId) && authorize(p, p.tenantId!, MANAGERS);
}

export async function listLessons(principal: Principal, courseId: string): Promise<LessonRow[]> {
  if (!principal.tenantId || !canManage(principal)) return [];
  const guard = tenantGuard(principal.tenantId);
  const { data } = await guard
    .from("lessons")
    .select("id, course_id, title, kind, content, position, status")
    .eq("course_id", courseId)
    .order("position");
  return (data ?? []) as LessonRow[];
}

async function courseInTenant(guard: ReturnType<typeof tenantGuard>, courseId: string): Promise<boolean> {
  const { data } = await guard.from("courses").select("id").eq("id", courseId).maybeSingle();
  return Boolean(data);
}

export async function createLesson(
  principal: Principal,
  courseId: string,
  raw: Record<string, unknown>,
): Promise<LessonMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const parsed = parseLessonInput(raw);
  if (!parsed.ok) return { ok: false, validation: parsed.errors };

  const guard = tenantGuard(principal.tenantId);
  if (!(await courseInTenant(guard, courseId))) return { ok: false, error: "course_not_found" };

  // La nueva lección va al final (posición máxima + 1).
  const { data: last } = await guard.db
    .from("lessons")
    .select("position")
    .eq("course_id", courseId)
    .eq("tenant_id", principal.tenantId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last?.position as number) ?? 0) + 1;

  const { data, error } = await guard.db
    .from("lessons")
    .insert(guard.withTenant({ course_id: courseId, position, ...toRow(parsed.value) }))
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "not_found" };
  return { ok: true, id: data.id as string };
}

export async function updateLesson(
  principal: Principal,
  lessonId: string,
  raw: Record<string, unknown>,
): Promise<LessonMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const parsed = parseLessonInput(raw);
  if (!parsed.ok) return { ok: false, validation: parsed.errors };

  const guard = tenantGuard(principal.tenantId);
  const { data, error } = await guard.db
    .from("lessons")
    .update(toRow(parsed.value))
    .eq("id", lessonId)
    .eq("tenant_id", principal.tenantId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "not_found" };
  return { ok: true, id: data.id as string };
}

export async function deleteLesson(principal: Principal, lessonId: string): Promise<LessonMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const guard = tenantGuard(principal.tenantId);
  const { data, error } = await guard.db
    .from("lessons")
    .delete()
    .eq("id", lessonId)
    .eq("tenant_id", principal.tenantId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "not_found" };
  return { ok: true, id: data.id as string };
}

/** Mueve una lección arriba/abajo intercambiando su posición con la vecina. */
export async function moveLesson(
  principal: Principal,
  lessonId: string,
  direction: "up" | "down",
): Promise<LessonMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const guard = tenantGuard(principal.tenantId);

  const { data: lesson } = await guard.db
    .from("lessons")
    .select("id, course_id, position")
    .eq("id", lessonId)
    .eq("tenant_id", principal.tenantId)
    .maybeSingle();
  if (!lesson) return { ok: false, error: "not_found" };

  const cmp = direction === "up" ? "lt" : "gt";
  const { data: neighbor } = await guard.db
    .from("lessons")
    .select("id, position")
    .eq("course_id", lesson.course_id)
    .eq("tenant_id", principal.tenantId)
    [cmp]("position", lesson.position)
    .order("position", { ascending: direction === "down" })
    .limit(1)
    .maybeSingle();
  if (!neighbor) return { ok: true, id: lessonId }; // ya está en el extremo

  // Intercambio de posiciones (dos updates).
  await guard.db.from("lessons").update({ position: neighbor.position }).eq("id", lesson.id).eq("tenant_id", principal.tenantId);
  await guard.db.from("lessons").update({ position: lesson.position }).eq("id", neighbor.id).eq("tenant_id", principal.tenantId);
  return { ok: true, id: lessonId };
}

function toRow(v: LessonInput): Record<string, unknown> {
  return { title: v.title, kind: v.kind, content: v.content, status: v.status };
}
