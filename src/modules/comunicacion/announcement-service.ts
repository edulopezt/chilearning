import "server-only";

import { writeAudit } from "@/lib/audit";
import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { parseAnnouncementInput, type FieldError } from "@/modules/comunicacion/domain/communication";
import { renderAnnouncementEmail } from "@/modules/comunicacion/domain/email-templates";
import { bestEffortEmail, courseAccess, loadBrand, notifyInApp } from "@/modules/comunicacion/notify";

/** Anuncios por curso/acción con fan-out al publicar (task 3.4, HU-9.1). */

const AUTHORS = ["otec_admin", "coordinator", "instructor"] as const;
const PAGE = 1000;

async function fetchAll<T>(page: (o: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let o = 0; ; o += PAGE) {
    const { data } = await page(o);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export interface AnnouncementRow {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly status: string;
  readonly publishedAt: string | null;
  readonly createdAt: string;
}

export async function listAnnouncements(principal: Principal, filter: { courseId?: string; actionId?: string }): Promise<AnnouncementRow[]> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, AUTHORS)) return [];
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  let q = guard.db.from("announcements").select("id, title, body, status, published_at, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (filter.courseId) q = q.eq("course_id", filter.courseId);
  if (filter.actionId) q = q.eq("action_id", filter.actionId);
  const { data } = await q;
  return ((data ?? []) as { id: string; title: string; body: string; status: string; published_at: string | null; created_at: string }[]).map((a) => ({
    id: a.id, title: a.title, body: a.body, status: a.status, publishedAt: a.published_at, createdAt: a.created_at,
  }));
}

/** Anuncios PUBLICADOS visibles para el alumno del curso (o el staff). */
export async function listPublishedAnnouncements(principal: Principal, courseId: string): Promise<AnnouncementRow[]> {
  if (!principal.tenantId) return [];
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  if (!(await courseAccess(guard, tenantId, principal, courseId))) return [];
  const actions = await fetchAll<{ id: string }>((o) => guard.db.from("actions").select("id").eq("tenant_id", tenantId).eq("course_id", courseId).order("id").range(o, o + PAGE - 1));
  let q = guard.db.from("announcements").select("id, title, body, status, published_at, created_at").eq("tenant_id", tenantId).eq("status", "published").order("published_at", { ascending: false });
  q = actions.length > 0 ? q.or(`course_id.eq.${courseId},action_id.in.(${actions.map((a) => a.id).join(",")})`) : q.eq("course_id", courseId);
  const { data } = await q;
  return ((data ?? []) as { id: string; title: string; body: string; status: string; published_at: string | null; created_at: string }[]).map((a) => ({ id: a.id, title: a.title, body: a.body, status: a.status, publishedAt: a.published_at, createdAt: a.created_at }));
}

export type AnnouncementWrite = { ok: true; id: string } | { ok: false; error: "forbidden" | "invalid"; errors?: FieldError[] };

export async function createAnnouncement(principal: Principal, raw: { title?: unknown; body?: unknown; courseId?: unknown; actionId?: unknown }): Promise<AnnouncementWrite> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, AUTHORS)) return { ok: false, error: "forbidden" };
  const parsed = parseAnnouncementInput(raw);
  if (!parsed.ok) return { ok: false, error: "invalid", errors: parsed.errors };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data, error } = await guard.db.from("announcements").insert(guard.withTenant({
    course_id: parsed.value.courseId, action_id: parsed.value.actionId, author_user_id: principal.userId,
    title: parsed.value.title, body: parsed.value.body,
  })).select("id").single();
  if (error || !data) return { ok: false, error: "forbidden" };
  await writeAudit(guard, { actorUserId: principal.userId, action: "announcement.created", entity: "announcements", entityId: data.id as string });
  return { ok: true, id: data.id as string };
}

/** Publica el anuncio y hace fan-out (una vez): notifica in-app + correo. */
export async function publishAnnouncement(principal: Principal, announcementId: string, courseUrl: string): Promise<{ ok: boolean; sent?: number }> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, AUTHORS)) return { ok: false };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data: ann } = await guard.db.from("announcements").select("id, course_id, action_id, title, body, status").eq("tenant_id", tenantId).eq("id", announcementId).maybeSingle();
  if (!ann) return { ok: false };
  if (ann.status === "published") return { ok: true, sent: 0 }; // idempotente: no re-envía

  await guard.db.from("announcements").update({ status: "published", published_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", announcementId);

  // Destinatarios: alumnos inscritos del curso o de la acción.
  let userIds: string[] = [];
  if (ann.action_id) {
    const rows = await fetchAll<{ user_id: string }>((o) => guard.db.from("enrollments").select("user_id").eq("tenant_id", tenantId).eq("action_id", ann.action_id as string).order("user_id").range(o, o + PAGE - 1));
    userIds = rows.map((r) => r.user_id);
  } else if (ann.course_id) {
    const actions = await fetchAll<{ id: string }>((o) => guard.db.from("actions").select("id").eq("tenant_id", tenantId).eq("course_id", ann.course_id as string).order("id").range(o, o + PAGE - 1));
    if (actions.length > 0) {
      const rows = await fetchAll<{ user_id: string }>((o) => guard.db.from("enrollments").select("user_id").eq("tenant_id", tenantId).in("action_id", actions.map((a) => a.id)).order("user_id").range(o, o + PAGE - 1));
      userIds = rows.map((r) => r.user_id);
    }
  }
  const unique = [...new Set(userIds)];
  const brand = await loadBrand(guard, tenantId);
  const email = renderAnnouncementEmail({ brand, title: ann.title as string, body: ann.body as string, courseUrl });
  let sent = 0;
  for (const uid of unique) {
    await notifyInApp(guard, uid, "announcement.published", { announcementId, title: ann.title });
    await bestEffortEmail(guard, uid, email);
    sent += 1;
  }
  await writeAudit(guard, { actorUserId: principal.userId, action: "announcement.published", entity: "announcements", entityId: announcementId, details: { recipients: sent } });
  return { ok: true, sent };
}
