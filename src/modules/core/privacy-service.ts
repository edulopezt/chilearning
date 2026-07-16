import "server-only";

import { writeAudit } from "@/lib/audit";
import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import {
  classifyForErasure,
  CURRENT_PRIVACY_POLICY_VERSION,
  parseDsrInput,
  type FieldError,
} from "@/modules/core/domain/privacy";

/**
 * Derechos Ley 21.719 (task 3.5, HU-2.4). Consentimiento al primer ingreso,
 * export del titular (JSON legible por máquina, autoservicio), solicitudes de
 * derechos y supresión que CONSERVA los registros SENCE/certificados/auditoría
 * (obligación legal prima) e informa lo retenido. Todo auditado (P8).
 */

const STAFF = ["otec_admin", "coordinator"] as const;
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

// ---------- consentimiento ----------

export async function hasCurrentConsent(principal: Principal): Promise<boolean> {
  if (!principal.tenantId) return false;
  const guard = tenantGuard(principal.tenantId);
  const { data } = await guard.db
    .from("consents")
    .select("id")
    .eq("tenant_id", principal.tenantId)
    .eq("user_id", principal.userId)
    .eq("policy_version", CURRENT_PRIVACY_POLICY_VERSION)
    .maybeSingle();
  return Boolean(data);
}

export async function recordConsent(principal: Principal, ip: string | null): Promise<{ ok: boolean }> {
  if (!principal.tenantId) return { ok: false };
  const guard = tenantGuard(principal.tenantId);
  const { error } = await guard.db.from("consents").insert(
    guard.withTenant({ user_id: principal.userId, policy_version: CURRENT_PRIVACY_POLICY_VERSION, ip }),
  );
  // 23505 = ya consintió esta versión → idempotente OK.
  if (error && error.code !== "23505") return { ok: false };
  await writeAudit(guard, { actorUserId: principal.userId, action: "consent.accepted", entity: "consents", entityId: principal.userId, details: { policyVersion: CURRENT_PRIVACY_POLICY_VERSION } });
  return { ok: true };
}

// ---------- export del titular (acceso + portabilidad) ----------

export interface DataExport {
  readonly generatedAt: string;
  readonly userId: string;
  readonly data: Record<string, unknown>;
}

export async function exportMyData(principal: Principal): Promise<DataExport | null> {
  if (!principal.tenantId) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  const enrollments = await fetchAll<{ id: string; action_id: string; run: string | null; first_names: string | null; last_names: string | null; exento: boolean }>((o) =>
    guard.db.from("enrollments").select("id, action_id, run, first_names, last_names, exento").eq("tenant_id", tenantId).eq("user_id", principal.userId).order("id").range(o, o + PAGE - 1));
  const enrollmentIds = enrollments.map((e) => e.id);

  const [memberships, consents, requests, grades, sessions, certificates] = await Promise.all([
    fetchAll<{ roles: string[]; created_at: string }>((o) => guard.db.from("memberships").select("roles, created_at").eq("tenant_id", tenantId).eq("user_id", principal.userId).range(o, o + PAGE - 1)),
    fetchAll<{ policy_version: string; accepted_at: string }>((o) => guard.db.from("consents").select("policy_version, accepted_at").eq("tenant_id", tenantId).eq("user_id", principal.userId).order("accepted_at").range(o, o + PAGE - 1)),
    fetchAll<{ kind: string; status: string; created_at: string }>((o) => guard.db.from("dsr_requests").select("kind, status, created_at").eq("tenant_id", tenantId).eq("user_id", principal.userId).order("created_at").range(o, o + PAGE - 1)),
    enrollmentIds.length ? fetchAll<{ grade: number; status: string }>((o) => guard.db.from("grades").select("grade, status").eq("tenant_id", tenantId).eq("status", "published").in("enrollment_id", enrollmentIds).range(o, o + PAGE - 1)) : Promise.resolve([]),
    enrollmentIds.length ? fetchAll<{ status: string; opened_at: string | null; closed_at: string | null }>((o) => guard.db.from("sence_sessions").select("status, opened_at, closed_at").eq("tenant_id", tenantId).in("enrollment_id", enrollmentIds).range(o, o + PAGE - 1)) : Promise.resolve([]),
    enrollmentIds.length ? fetchAll<{ folio: string; status: string; issued_at: string }>((o) => guard.db.from("certificates").select("folio, status, issued_at").eq("tenant_id", tenantId).in("enrollment_id", enrollmentIds).range(o, o + PAGE - 1)) : Promise.resolve([]),
  ]);

  await writeAudit(guard, { actorUserId: principal.userId, action: "dsr.export", entity: "users", entityId: principal.userId });
  return {
    generatedAt: new Date().toISOString(),
    userId: principal.userId,
    data: { memberships, enrollments, grades, senceSessions: sessions, certificates, consents, dataRequests: requests },
  };
}

// ---------- solicitudes de derechos ----------

export type DsrResult = { ok: true; id: string } | { ok: false; error: "forbidden" | "invalid"; errors?: FieldError[] };

export async function requestDsr(principal: Principal, raw: { kind?: unknown; detail?: unknown }): Promise<DsrResult> {
  if (!principal.tenantId) return { ok: false, error: "forbidden" };
  const parsed = parseDsrInput(raw);
  if (!parsed.ok) return { ok: false, error: "invalid", errors: parsed.errors };
  const guard = tenantGuard(principal.tenantId);
  const { data, error } = await guard.db.from("dsr_requests").insert(guard.withTenant({ user_id: principal.userId, kind: parsed.value.kind, detail: parsed.value.detail })).select("id").single();
  if (error || !data) return { ok: false, error: "forbidden" };
  await writeAudit(guard, { actorUserId: principal.userId, action: "dsr.requested", entity: "dsr_requests", entityId: data.id as string, details: { kind: parsed.value.kind } });
  return { ok: true, id: data.id as string };
}

export interface DsrRow {
  readonly id: string;
  readonly userId: string;
  readonly kind: string;
  readonly status: string;
  readonly detail: string;
  readonly resolutionNote: string;
  readonly createdAt: string;
}

export async function listDsrRequests(principal: Principal): Promise<DsrRow[]> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, STAFF)) return [];
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const rows = await fetchAll<{ id: string; user_id: string; kind: string; status: string; detail: string; resolution_note: string; created_at: string }>((o) =>
    guard.db.from("dsr_requests").select("id, user_id, kind, status, detail, resolution_note, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).range(o, o + PAGE - 1));
  return rows.map((r) => ({ id: r.id, userId: r.user_id, kind: r.kind, status: r.status, detail: r.detail, resolutionNote: r.resolution_note, createdAt: r.created_at }));
}

/** Resuelve una solicitud (rectificación/portabilidad/rechazo) con nota. */
export async function resolveDsr(principal: Principal, requestId: string, status: "completed" | "rejected", note: string): Promise<{ ok: boolean }> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, STAFF)) return { ok: false };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  // Una supresión NO se cierra como "completed" por esta vía sin anonimizar: debe
  // pasar por applyErasure (4-ojos LOW). Rechazarla aquí sí es válido.
  if (status === "completed") {
    const { data: r } = await guard.db.from("dsr_requests").select("kind").eq("tenant_id", tenantId).eq("id", requestId).maybeSingle();
    if (r?.kind === "erasure") return { ok: false };
  }
  const { data, error } = await guard.db.from("dsr_requests").update({ status, resolution_note: note, resolved_by: principal.userId, resolved_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", requestId).select("id, kind").maybeSingle();
  if (error || !data) return { ok: false };
  await writeAudit(guard, { actorUserId: principal.userId, action: "dsr.resolved", entity: "dsr_requests", entityId: requestId, details: { status } });
  return { ok: true };
}

/**
 * Aplica una supresión: anonimiza el PERFIL de auth (user_metadata) y CONSERVA
 * los registros SENCE/certificados/notas/auditoría (obligación legal, P4). El
 * `resolution_note` informa lo retenido y su motivo. NO borra el usuario auth
 * (dependencias FK; el borrado duro es manual/diferido).
 */
export async function applyErasure(principal: Principal, requestId: string): Promise<{ ok: boolean; retainedCount?: number }> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, STAFF)) return { ok: false };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data: req } = await guard.db.from("dsr_requests").select("id, user_id, kind").eq("tenant_id", tenantId).eq("id", requestId).maybeSingle();
  if (!req) return { ok: false };
  const targetUserId = req.user_id as string;

  // Suprime de VERDAD los datos NO retenidos (4-ojos HIGH: no afirmar lo que no
  // se hace). Los registros SENCE/certificados/notas/auditoría NO se tocan.
  const REDACTED = "[contenido suprimido por solicitud del titular]";
  // 1) Perfil de auth: nombre + correo (identificadores directos no retenidos).
  await guard.db.auth.admin.updateUserById(targetUserId, {
    email: `erased+${targetUserId}@erased.invalid`,
    user_metadata: { full_name: null, erased: true, erased_at: new Date().toISOString() },
  }).catch(() => undefined);
  // 2) Comunicación del titular (foro, mensajes) — texto atribuible.
  await guard.db.from("forum_posts").update({ body: REDACTED }).eq("tenant_id", tenantId).eq("author_user_id", targetUserId);
  await guard.db.from("messages").update({ body: REDACTED }).eq("tenant_id", tenantId).eq("sender_user_id", targetUserId);
  await guard.db.from("message_threads").update({ subject: "[suprimido]" }).eq("tenant_id", tenantId).eq("student_user_id", targetUserId);

  const classification = classifyForErasure();
  const note = `Supresión aplicada. Conservado por obligación legal: ${classification.retained.map((r) => `${r.dataType} (${r.reason})`).join("; ")}. Suprimido: ${classification.erasable.join("; ")}.`;

  const { error } = await guard.db.from("dsr_requests").update({ status: "completed", resolution_note: note, resolved_by: principal.userId, resolved_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", requestId);
  if (error) return { ok: false };
  await writeAudit(guard, { actorUserId: principal.userId, action: "dsr.erasure_applied", entity: "dsr_requests", entityId: requestId, details: { targetUserId, retainedCount: classification.retained.length } });
  return { ok: true, retainedCount: classification.retained.length };
}
