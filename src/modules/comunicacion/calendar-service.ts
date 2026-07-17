import "server-only";

import { writeAudit } from "@/lib/audit";
import { tenantGuard, type TenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { mergeCalendar, parseCalendarItemInput, type CalendarEntry, type FieldError } from "@/modules/comunicacion/domain/communication";
import { courseAccess } from "@/modules/comunicacion/notify";

/** Calendario del curso (task 3.4, HU-9.4): ítems manuales + plazos de
 *  instrumentos (proyección; los plazos no se duplican en la tabla). */

const EDITORS = ["otec_admin", "coordinator", "instructor"] as const;

/**
 * Sesiones en vivo (task 5.4, spec §7-R3) para el calendario. A diferencia de
 * `assignments`/`quizzes` (entidades de CURSO, compartidas entre acciones),
 * `live_sessions` es a nivel de ACCIÓN: un curso admite varias acciones
 * concurrentes (cohortes — ver task 2.8, re-ejecución de acción). El staff ve
 * las de TODAS las acciones del curso; el alumno SOLO ve las de su(s) propia(s)
 * acción(es) de inscripción — nunca las de otra acción del mismo curso (mismo
 * alcance que la policy RLS `live_sessions_select`, ver el caso adversarial en
 * `live-sessions.rls.test.ts`).
 */
async function liveSessionCalendarRows(
  guard: TenantGuard,
  tenantId: string,
  userId: string,
  courseId: string,
  access: "staff" | "student",
): Promise<{ title: string; starts_at: string }[]> {
  if (access === "staff") {
    const { data } = await guard.db
      .from("live_sessions")
      .select("title, starts_at, actions!inner(course_id)")
      .eq("tenant_id", tenantId)
      .eq("actions.course_id", courseId);
    return (data ?? []) as unknown as { title: string; starts_at: string }[];
  }

  const { data: myEnrollments } = await guard.db
    .from("enrollments")
    .select("action_id, actions!inner(course_id)")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("actions.course_id", courseId);
  const actionIds = [...new Set(((myEnrollments ?? []) as { action_id: string }[]).map((e) => e.action_id))];
  if (actionIds.length === 0) return [];

  const { data } = await guard.db
    .from("live_sessions")
    .select("title, starts_at")
    .eq("tenant_id", tenantId)
    .in("action_id", actionIds);
  return (data ?? []) as { title: string; starts_at: string }[];
}

export async function listCalendar(principal: Principal, courseId: string): Promise<CalendarEntry[] | null> {
  if (!principal.tenantId) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const access = await courseAccess(guard, tenantId, principal, courseId);
  if (!access) return null;

  const [{ data: items }, { data: assignments }, { data: quizzes }, sessions] = await Promise.all([
    guard.db.from("calendar_items").select("kind, title, due_at").eq("tenant_id", tenantId).eq("course_id", courseId),
    guard.db.from("assignments").select("title, due_at").eq("tenant_id", tenantId).eq("course_id", courseId).eq("status", "published").not("due_at", "is", null),
    guard.db.from("quizzes").select("title, closes_at").eq("tenant_id", tenantId).eq("course_id", courseId).eq("status", "published").not("closes_at", "is", null),
    liveSessionCalendarRows(guard, tenantId, principal.userId, courseId, access),
  ]);

  const manual = ((items ?? []) as { kind: string; title: string; due_at: string }[]).map((i) => ({ kind: i.kind, title: i.title, dueAtMs: Date.parse(i.due_at) }));
  const instruments = [
    ...((assignments ?? []) as { title: string; due_at: string }[]).map((a) => ({ kind: "plazo", title: a.title, dueAtMs: Date.parse(a.due_at) })),
    ...((quizzes ?? []) as { title: string; closes_at: string }[]).map((q) => ({ kind: "evaluacion", title: q.title, dueAtMs: Date.parse(q.closes_at) })),
    ...sessions.map((s) => ({ kind: "sesion", title: s.title, dueAtMs: Date.parse(s.starts_at) })),
  ];
  return mergeCalendar(manual, instruments);
}

export type CalendarWrite = { ok: true; id: string } | { ok: false; error: "forbidden" | "invalid"; errors?: FieldError[] };

export async function createCalendarItem(principal: Principal, courseId: string, raw: { kind?: unknown; title?: unknown; description?: unknown; dueAt?: unknown }): Promise<CalendarWrite> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, EDITORS)) return { ok: false, error: "forbidden" };
  const parsed = parseCalendarItemInput(raw);
  if (!parsed.ok) return { ok: false, error: "invalid", errors: parsed.errors };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data, error } = await guard.db.from("calendar_items").insert(guard.withTenant({ course_id: courseId, kind: parsed.value.kind, title: parsed.value.title, description: parsed.value.description, due_at: parsed.value.dueAtISO, created_by: principal.userId })).select("id").single();
  if (error || !data) return { ok: false, error: "forbidden" };
  await writeAudit(guard, { actorUserId: principal.userId, action: "calendar.created", entity: "calendar_items", entityId: data.id as string });
  return { ok: true, id: data.id as string };
}

export async function deleteCalendarItem(principal: Principal, itemId: string): Promise<{ ok: boolean }> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, EDITORS)) return { ok: false };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { error } = await guard.db.from("calendar_items").delete().eq("tenant_id", tenantId).eq("id", itemId);
  return { ok: !error };
}
