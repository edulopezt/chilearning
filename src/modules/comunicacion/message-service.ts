import "server-only";

import { writeAudit } from "@/lib/audit";
import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { parseMessageInput, responseAge, type FieldError, type Sla } from "@/modules/comunicacion/domain/communication";
import { renderMessageEmail } from "@/modules/comunicacion/domain/email-templates";
import { bestEffortEmail, courseAccess, loadBrand, notifyInApp } from "@/modules/comunicacion/notify";

/** Mensajería asincrónica alumno↔relator/tutor (task 3.4, HU-9.3, exigible SENCE).
 *  Hilos por (curso, alumno); tiempos de respuesta visibles (SLA). */

const STAFF_ROLES = ["otec_admin", "coordinator", "instructor", "tutor"] as const;

export interface MessageThreadRow {
  readonly id: string;
  readonly subject: string;
  readonly courseId: string;
  readonly studentUserId: string;
  readonly lastMessageAt: string;
  readonly sla: Sla;
  readonly pendingSinceMs: number | null;
}
export interface MessageRow {
  readonly id: string;
  readonly body: string;
  readonly senderIsStaff: boolean;
  readonly senderUserId: string;
  readonly createdAt: string;
}

function isStaff(principal: Principal): boolean {
  return Boolean(principal.tenantId) && authorize(principal, principal.tenantId!, STAFF_ROLES);
}

/** Hilos: el alumno los suyos; el staff los del tenant (o de un curso). */
export async function listMyThreads(principal: Principal, courseId?: string): Promise<MessageThreadRow[]> {
  if (!principal.tenantId) return [];
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  let q = guard.db.from("message_threads").select("id, subject, course_id, student_user_id, last_message_at").eq("tenant_id", tenantId).order("last_message_at", { ascending: false });
  if (!isStaff(principal)) q = q.eq("student_user_id", principal.userId);
  if (courseId) q = q.eq("course_id", courseId);
  const { data: threads } = await q;
  const rows = (threads ?? []) as { id: string; subject: string; course_id: string; student_user_id: string; last_message_at: string }[];
  // SLA por hilo desde los mensajes.
  const out: MessageThreadRow[] = [];
  const now = Date.now();
  for (const t of rows) {
    const { data: msgs } = await guard.db.from("messages").select("created_at, sender_is_staff").eq("tenant_id", tenantId).eq("thread_id", t.id).order("created_at", { ascending: true });
    const events = ((msgs ?? []) as { created_at: string; sender_is_staff: boolean }[]).map((m) => ({ atMs: Date.parse(m.created_at), fromStaff: m.sender_is_staff }));
    const age = responseAge(events, now);
    out.push({ id: t.id, subject: t.subject, courseId: t.course_id, studentUserId: t.student_user_id, lastMessageAt: t.last_message_at, sla: age.sla, pendingSinceMs: age.pendingSinceMs });
  }
  return out;
}

export async function getThread(principal: Principal, threadId: string): Promise<{ thread: MessageThreadRow; messages: MessageRow[] } | null> {
  if (!principal.tenantId) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data: t } = await guard.db.from("message_threads").select("id, subject, course_id, student_user_id, last_message_at").eq("tenant_id", tenantId).eq("id", threadId).maybeSingle();
  if (!t) return null;
  if (!isStaff(principal) && t.student_user_id !== principal.userId) return null;
  const { data: msgs } = await guard.db.from("messages").select("id, body, sender_is_staff, sender_user_id, created_at").eq("tenant_id", tenantId).eq("thread_id", threadId).order("created_at", { ascending: true });
  const messages = ((msgs ?? []) as { id: string; body: string; sender_is_staff: boolean; sender_user_id: string; created_at: string }[]).map((m) => ({ id: m.id, body: m.body, senderIsStaff: m.sender_is_staff, senderUserId: m.sender_user_id, createdAt: m.created_at }));
  const age = responseAge(messages.map((m) => ({ atMs: Date.parse(m.createdAt), fromStaff: m.senderIsStaff })), Date.now());
  return {
    thread: { id: t.id as string, subject: t.subject as string, courseId: t.course_id as string, studentUserId: t.student_user_id as string, lastMessageAt: t.last_message_at as string, sla: age.sla, pendingSinceMs: age.pendingSinceMs },
    messages,
  };
}

export type MessageWrite = { ok: true; id: string } | { ok: false; error: "forbidden" | "invalid"; errors?: FieldError[] };

/** El alumno inicia un hilo (asunto + primer mensaje) sobre un curso en que está inscrito. */
export async function startThread(principal: Principal, courseId: string, raw: { subject?: unknown; body?: unknown }): Promise<MessageWrite> {
  if (!principal.tenantId) return { ok: false, error: "forbidden" };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const access = await courseAccess(guard, tenantId, principal, courseId);
  if (access !== "student") return { ok: false, error: "forbidden" };
  const parsed = parseMessageInput(raw);
  if (!parsed.ok) return { ok: false, error: "invalid", errors: parsed.errors };
  const { data, error } = await guard.db.from("message_threads").insert(guard.withTenant({ course_id: courseId, student_user_id: principal.userId, subject: parsed.value.subject })).select("id").single();
  if (error || !data) return { ok: false, error: "forbidden" };
  await guard.db.from("messages").insert(guard.withTenant({ thread_id: data.id, sender_user_id: principal.userId, sender_is_staff: false, body: parsed.value.body }));
  return { ok: true, id: data.id as string };
}

export async function sendMessage(principal: Principal, threadId: string, raw: { body?: unknown }, courseUrl: string): Promise<MessageWrite> {
  if (!principal.tenantId) return { ok: false, error: "forbidden" };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data: t } = await guard.db.from("message_threads").select("id, subject, student_user_id").eq("tenant_id", tenantId).eq("id", threadId).maybeSingle();
  if (!t) return { ok: false, error: "forbidden" };
  const staff = isStaff(principal);
  if (!staff && t.student_user_id !== principal.userId) return { ok: false, error: "forbidden" };
  const parsed = parseMessageInput({ subject: "x", body: raw.body });
  if (!parsed.ok) return { ok: false, error: "invalid", errors: parsed.errors.filter((e) => e.field !== "subject") };
  const { data, error } = await guard.db.from("messages").insert(guard.withTenant({ thread_id: threadId, sender_user_id: principal.userId, sender_is_staff: staff, body: parsed.value.body })).select("id").single();
  if (error || !data) return { ok: false, error: "forbidden" };
  await guard.db.from("message_threads").update({ last_message_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", threadId);
  // El staff que responde avisa al alumno dueño del hilo.
  if (staff) {
    await notifyInApp(guard, t.student_user_id as string, "message.received", { threadId, subject: t.subject });
    const brand = await loadBrand(guard, tenantId);
    await bestEffortEmail(guard, t.student_user_id as string, renderMessageEmail({ brand, subjectLine: t.subject as string, courseUrl }));
    await writeAudit(guard, { actorUserId: principal.userId, action: "message.sent", entity: "message_threads", entityId: threadId });
  }
  return { ok: true, id: data.id as string };
}
