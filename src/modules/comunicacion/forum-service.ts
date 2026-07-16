import "server-only";

import { writeAudit } from "@/lib/audit";
import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { parsePostInput, parseThreadInput, type FieldError } from "@/modules/comunicacion/domain/communication";
import { renderForumReplyEmail } from "@/modules/comunicacion/domain/email-templates";
import { bestEffortEmail, courseAccess, loadBrand, notifyInApp } from "@/modules/comunicacion/notify";

/** Foro de consultas del curso (task 3.4, HU-9.2): hilos + respuestas planas;
 *  modera el staff (marca "resuelta"). Alumno inscrito y staff participan. */

const MODERATORS = ["otec_admin", "coordinator", "instructor", "tutor"] as const;

export interface ForumThread {
  readonly id: string;
  readonly title: string;
  readonly resolved: boolean;
  readonly authorUserId: string;
  readonly createdAt: string;
}
export interface ForumPost {
  readonly id: string;
  readonly body: string;
  readonly fromStaff: boolean;
  readonly authorUserId: string;
  readonly createdAt: string;
}

export async function listThreads(principal: Principal, courseId: string): Promise<ForumThread[] | null> {
  if (!principal.tenantId) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  if (!(await courseAccess(guard, tenantId, principal, courseId))) return null;
  const { data } = await guard.db.from("forum_threads").select("id, title, resolved, author_user_id, created_at").eq("tenant_id", tenantId).eq("course_id", courseId).order("created_at", { ascending: false });
  return ((data ?? []) as { id: string; title: string; resolved: boolean; author_user_id: string; created_at: string }[]).map((t) => ({ id: t.id, title: t.title, resolved: t.resolved, authorUserId: t.author_user_id, createdAt: t.created_at }));
}

export async function getThread(principal: Principal, threadId: string): Promise<{ thread: ForumThread; posts: ForumPost[] } | null> {
  if (!principal.tenantId) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data: t } = await guard.db.from("forum_threads").select("id, course_id, title, resolved, author_user_id, created_at").eq("tenant_id", tenantId).eq("id", threadId).maybeSingle();
  if (!t) return null;
  if (!(await courseAccess(guard, tenantId, principal, t.course_id as string))) return null;
  const { data: posts } = await guard.db.from("forum_posts").select("id, body, from_staff, author_user_id, created_at").eq("tenant_id", tenantId).eq("thread_id", threadId).order("created_at", { ascending: true });
  return {
    thread: { id: t.id as string, title: t.title as string, resolved: t.resolved as boolean, authorUserId: t.author_user_id as string, createdAt: t.created_at as string },
    posts: ((posts ?? []) as { id: string; body: string; from_staff: boolean; author_user_id: string; created_at: string }[]).map((p) => ({ id: p.id, body: p.body, fromStaff: p.from_staff, authorUserId: p.author_user_id, createdAt: p.created_at })),
  };
}

export type ForumWrite = { ok: true; id: string } | { ok: false; error: "forbidden" | "invalid"; errors?: FieldError[] };

export async function createThread(principal: Principal, courseId: string, raw: { title?: unknown; body?: unknown }): Promise<ForumWrite> {
  if (!principal.tenantId) return { ok: false, error: "forbidden" };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const access = await courseAccess(guard, tenantId, principal, courseId);
  if (!access) return { ok: false, error: "forbidden" };
  const parsedTitle = parseThreadInput(raw);
  const parsedBody = parsePostInput(raw);
  if (!parsedTitle.ok) return { ok: false, error: "invalid", errors: parsedTitle.errors };
  if (!parsedBody.ok) return { ok: false, error: "invalid", errors: parsedBody.errors };
  const { data, error } = await guard.db.from("forum_threads").insert(guard.withTenant({ course_id: courseId, author_user_id: principal.userId, title: parsedTitle.value.title })).select("id").single();
  if (error || !data) return { ok: false, error: "forbidden" };
  await guard.db.from("forum_posts").insert(guard.withTenant({ thread_id: data.id, author_user_id: principal.userId, from_staff: access === "staff", body: parsedBody.value.body }));
  return { ok: true, id: data.id as string };
}

export async function addPost(principal: Principal, threadId: string, raw: { body?: unknown }, courseUrl: string): Promise<ForumWrite> {
  if (!principal.tenantId) return { ok: false, error: "forbidden" };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data: t } = await guard.db.from("forum_threads").select("id, course_id, title, author_user_id").eq("tenant_id", tenantId).eq("id", threadId).maybeSingle();
  if (!t) return { ok: false, error: "forbidden" };
  const access = await courseAccess(guard, tenantId, principal, t.course_id as string);
  if (!access) return { ok: false, error: "forbidden" };
  const parsed = parsePostInput(raw);
  if (!parsed.ok) return { ok: false, error: "invalid", errors: parsed.errors };
  const fromStaff = access === "staff";
  const { data, error } = await guard.db.from("forum_posts").insert(guard.withTenant({ thread_id: threadId, author_user_id: principal.userId, from_staff: fromStaff, body: parsed.value.body })).select("id").single();
  if (error || !data) return { ok: false, error: "forbidden" };
  // Si responde el staff, avisa al autor del hilo (si no es él mismo).
  if (fromStaff && t.author_user_id !== principal.userId) {
    await notifyInApp(guard, t.author_user_id as string, "forum.reply", { threadId, title: t.title });
    const brand = await loadBrand(guard, tenantId);
    await bestEffortEmail(guard, t.author_user_id as string, renderForumReplyEmail({ brand, threadTitle: t.title as string, courseUrl }));
    await writeAudit(guard, { actorUserId: principal.userId, action: "forum.replied", entity: "forum_threads", entityId: threadId });
  }
  return { ok: true, id: data.id as string };
}

export async function resolveThread(principal: Principal, threadId: string, resolved: boolean): Promise<{ ok: boolean }> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, MODERATORS)) return { ok: false };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data, error } = await guard.db.from("forum_threads").update({ resolved, resolved_by: resolved ? principal.userId : null, resolved_at: resolved ? new Date().toISOString() : null }).eq("tenant_id", tenantId).eq("id", threadId).select("id").maybeSingle();
  if (error || !data) return { ok: false };
  await writeAudit(guard, { actorUserId: principal.userId, action: "forum.resolved", entity: "forum_threads", entityId: threadId, details: { resolved } });
  return { ok: true };
}
