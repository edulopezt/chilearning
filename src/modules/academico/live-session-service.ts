import "server-only";

import { writeAudit } from "@/lib/audit";
import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import {
  attendanceCsv,
  canSelfMark,
  formatMarkedAt,
  parseLiveSessionInput,
  type AttendanceCsvRow,
  type LiveSessionFieldError,
  type LiveSessionProvider,
} from "@/modules/academico/domain/live-session";

/**
 * Sincrónico en vivo (task 5.4, spec §7-R3): programación de sesiones en vivo
 * por acción (enlace EXTERNO a Zoom/Meet/Teams) + asistencia INTERNA (no
 * SENCE/RCE) por sesión. Escrituras vía service-role bajo `tenantGuard()`,
 * igual que el resto del módulo académico.
 *
 * ⚠ Esta asistencia es informativa: NO abre/cierra el candado de contenido, NO
 * es evidencia SENCE, y no participa en la DJ/GCA. Ver
 * docs/sence/SINCRONICO-PENDIENTE-NORMA.md. Este archivo no importa ni
 * referencia `src/modules/sence/` en ninguna forma.
 */

const EDITORS = ["otec_admin", "coordinator", "instructor"] as const;
// Lectura (listar/ver asistencia): mismo staff que puede LEER por RLS (incluye
// tutor, que en `live_sessions_select`/`live_session_attendance_select` puede
// leer pero no gestiona sesiones ni marca asistencia).
const STAFF_VIEWERS = ["otec_admin", "coordinator", "instructor", "tutor"] as const;

function canEdit(p: Principal): boolean {
  return Boolean(p.tenantId) && authorize(p, p.tenantId!, EDITORS);
}
function canView(p: Principal): boolean {
  return Boolean(p.tenantId) && authorize(p, p.tenantId!, STAFF_VIEWERS);
}

export interface LiveSessionRow {
  readonly id: string;
  readonly actionId: string;
  readonly title: string;
  readonly provider: LiveSessionProvider;
  readonly meetingUrl: string;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
  readonly details: string;
}

interface RawSessionRow {
  id: string;
  action_id: string;
  title: string;
  provider: string;
  meeting_url: string;
  starts_at: string;
  ends_at: string;
  details: string;
}

function toRow(r: RawSessionRow): LiveSessionRow {
  return {
    id: r.id,
    actionId: r.action_id,
    title: r.title,
    provider: r.provider as LiveSessionProvider,
    meetingUrl: r.meeting_url,
    startsAtMs: Date.parse(r.starts_at),
    endsAtMs: Date.parse(r.ends_at),
    details: r.details,
  };
}

const SESSION_COLUMNS = "id, action_id, title, provider, meeting_url, starts_at, ends_at, details";

export type LiveSessionWriteError = "forbidden" | "no_tenant" | "not_found" | "invalid";
export type LiveSessionMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: LiveSessionWriteError; errors?: LiveSessionFieldError[] };

/** Crea una sesión en vivo para una acción del tenant (task 5.4). */
export async function createLiveSession(
  principal: Principal,
  actionId: string,
  raw: Record<string, unknown>,
): Promise<LiveSessionMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canEdit(principal)) return { ok: false, error: "forbidden" };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  // La acción debe existir y ser del tenant (aislamiento explícito, igual que
  // `createAction` valida el curso).
  const { data: action } = await guard.db
    .from("actions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", actionId)
    .maybeSingle();
  if (!action) return { ok: false, error: "not_found" };

  const parsed = parseLiveSessionInput(raw);
  if (!parsed.ok) return { ok: false, error: "invalid", errors: parsed.errors };

  const { data, error } = await guard.db
    .from("live_sessions")
    .insert(
      guard.withTenant({
        action_id: actionId,
        title: parsed.value.title,
        provider: parsed.value.provider,
        meeting_url: parsed.value.meetingUrl,
        starts_at: parsed.value.startsAtISO,
        ends_at: parsed.value.endsAtISO,
        details: parsed.value.details,
        created_by: principal.userId,
      }),
    )
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "not_found" };

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "live_session.created",
    entity: "live_sessions",
    entityId: data.id as string,
    details: { actionId },
  });
  return { ok: true, id: data.id as string };
}

/** Edita una sesión en vivo existente (la acción de destino no cambia). */
export async function updateLiveSession(
  principal: Principal,
  sessionId: string,
  raw: Record<string, unknown>,
): Promise<LiveSessionMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canEdit(principal)) return { ok: false, error: "forbidden" };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  const parsed = parseLiveSessionInput(raw);
  if (!parsed.ok) return { ok: false, error: "invalid", errors: parsed.errors };

  const { data, error } = await guard.db
    .from("live_sessions")
    .update({
      title: parsed.value.title,
      provider: parsed.value.provider,
      meeting_url: parsed.value.meetingUrl,
      starts_at: parsed.value.startsAtISO,
      ends_at: parsed.value.endsAtISO,
      details: parsed.value.details,
    })
    .eq("id", sessionId)
    .eq("tenant_id", tenantId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "not_found" };
  return { ok: true, id: data.id as string };
}

export type LiveSessionDeleteError = "forbidden" | "no_tenant" | "not_found" | "has_attendance";
export type LiveSessionDeleteResult = { ok: true } | { ok: false; error: LiveSessionDeleteError };

/**
 * Borra una sesión SOLO si no tiene ninguna fila de asistencia registrada
 * (ni self ni manual): una sesión con asistencia es evidencia y no se borra
 * (tampoco se corrige en cascada — se corrige con un nuevo `markAttendance`).
 */
export async function deleteLiveSession(
  principal: Principal,
  sessionId: string,
): Promise<LiveSessionDeleteResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canEdit(principal)) return { ok: false, error: "forbidden" };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  const { data: session } = await guard.db
    .from("live_sessions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { ok: false, error: "not_found" };

  const { count } = await guard.db
    .from("live_session_attendance")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("session_id", sessionId);
  if ((count ?? 0) > 0) return { ok: false, error: "has_attendance" };

  const { error } = await guard.db.from("live_sessions").delete().eq("id", sessionId).eq("tenant_id", tenantId);
  if (error) return { ok: false, error: "not_found" };
  return { ok: true };
}

/** Una sesión puntual por id (staff), para encabezados de página. */
export async function getSessionById(principal: Principal, sessionId: string): Promise<LiveSessionRow | null> {
  if (!principal.tenantId || !canView(principal)) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data } = await guard.db
    .from("live_sessions")
    .select(SESSION_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", sessionId)
    .maybeSingle();
  return data ? toRow(data as RawSessionRow) : null;
}

/** Lista las sesiones de una acción, ordenadas por inicio (staff). */
export async function listSessionsByAction(principal: Principal, actionId: string): Promise<LiveSessionRow[]> {
  if (!principal.tenantId || !canView(principal)) return [];
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data } = await guard.db
    .from("live_sessions")
    .select(SESSION_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("action_id", actionId)
    .order("starts_at", { ascending: true });
  return ((data ?? []) as RawSessionRow[]).map(toRow);
}

export interface MyLiveSessionRow extends LiveSessionRow {
  readonly enrollmentId: string;
}

/** Sesiones de las acciones donde el alumno está inscrito (su propio portal). */
export async function listMySessions(principal: Principal): Promise<MyLiveSessionRow[]> {
  if (!principal.tenantId) return [];
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  const { data: enr } = await guard.db
    .from("enrollments")
    .select("id, action_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", principal.userId);
  const enrollments = (enr ?? []) as { id: string; action_id: string }[];
  if (enrollments.length === 0) return [];
  const enrollmentByAction = new Map(enrollments.map((e) => [e.action_id, e.id]));

  const { data } = await guard.db
    .from("live_sessions")
    .select(SESSION_COLUMNS)
    .eq("tenant_id", tenantId)
    .in("action_id", [...enrollmentByAction.keys()])
    .order("starts_at", { ascending: true });

  return ((data ?? []) as RawSessionRow[]).map((r) => ({
    ...toRow(r),
    enrollmentId: enrollmentByAction.get(r.action_id)!,
  }));
}

export type AttendanceWriteError = "forbidden" | "no_tenant" | "not_found" | "mismatched_action";
export type AttendanceWriteResult = { ok: true } | { ok: false; error: AttendanceWriteError };

/** Marca la asistencia de UN inscrito (staff) — `source: "manual"`. */
export async function markAttendance(
  principal: Principal,
  sessionId: string,
  enrollmentId: string,
  present: boolean,
  note?: string,
): Promise<AttendanceWriteResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canEdit(principal)) return { ok: false, error: "forbidden" };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  const { data: session } = await guard.db
    .from("live_sessions")
    .select("id, action_id")
    .eq("tenant_id", tenantId)
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { ok: false, error: "not_found" };

  const { data: enrollment } = await guard.db
    .from("enrollments")
    .select("id, action_id")
    .eq("tenant_id", tenantId)
    .eq("id", enrollmentId)
    .maybeSingle();
  if (!enrollment) return { ok: false, error: "not_found" };
  // El inscrito DEBE ser de la MISMA acción que la sesión (no se marca
  // asistencia de un alumno de otra acción, aunque sea del mismo tenant).
  if (enrollment.action_id !== session.action_id) return { ok: false, error: "mismatched_action" };

  const trimmedNote = (note ?? "").trim().slice(0, 500);
  const { error } = await guard.db.from("live_session_attendance").upsert(
    guard.withTenant({
      session_id: sessionId,
      enrollment_id: enrollmentId,
      present,
      source: "manual",
      marked_by: principal.userId,
      note: trimmedNote,
      marked_at: new Date().toISOString(),
    }),
    { onConflict: "session_id,enrollment_id" },
  );
  if (error) return { ok: false, error: "not_found" };

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "live_attendance.marked",
    entity: "live_session_attendance",
    entityId: sessionId,
    details: { enrollmentId, present },
  });
  return { ok: true };
}

export type SelfMarkError = "forbidden" | "no_tenant" | "not_found" | "outside_window";
export type SelfMarkResult =
  | { ok: true; kept: "self" | "manual" }
  | { ok: false; error: SelfMarkError };

/**
 * Auto-marca del propio alumno — `source: "self"`. Regla "manual gana": si ya
 * existe una fila `manual` (el staff ya la marcó), el self-mark NO la
 * sobreescribe (se informa `kept: "manual"`, sin error).
 */
export async function selfMarkAttendance(principal: Principal, sessionId: string): Promise<SelfMarkResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  const { data: session } = await guard.db
    .from("live_sessions")
    .select("id, action_id, starts_at, ends_at")
    .eq("tenant_id", tenantId)
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { ok: false, error: "not_found" };

  const { data: enrollment } = await guard.db
    .from("enrollments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", principal.userId)
    .eq("action_id", session.action_id)
    .maybeSingle();
  if (!enrollment) return { ok: false, error: "forbidden" };

  const startsAtMs = Date.parse(session.starts_at as string);
  const endsAtMs = Date.parse(session.ends_at as string);
  if (!canSelfMark(startsAtMs, endsAtMs, Date.now())) return { ok: false, error: "outside_window" };

  const { data: existing } = await guard.db
    .from("live_session_attendance")
    .select("id, source")
    .eq("tenant_id", tenantId)
    .eq("session_id", sessionId)
    .eq("enrollment_id", enrollment.id)
    .maybeSingle();
  if (existing && existing.source === "manual") {
    return { ok: true, kept: "manual" };
  }

  const { error } = await guard.db.from("live_session_attendance").upsert(
    guard.withTenant({
      session_id: sessionId,
      enrollment_id: enrollment.id,
      present: true,
      source: "self",
      marked_by: principal.userId,
      marked_at: new Date().toISOString(),
    }),
    { onConflict: "session_id,enrollment_id" },
  );
  if (error) return { ok: false, error: "not_found" };

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "live_attendance.self",
    entity: "live_session_attendance",
    entityId: sessionId,
    details: { enrollmentId: enrollment.id },
  });
  return { ok: true, kept: "self" };
}

export interface RosterRow {
  readonly enrollmentId: string;
  readonly nombres: string;
  readonly apellidos: string;
  /** null = sin marca todavía (ni self ni manual). */
  readonly present: boolean | null;
  readonly source: "self" | "manual" | null;
  readonly note: string;
}

/**
 * Roster COMPLETO de inscritos de la acción de la sesión (para el toggle del
 * staff), con la marca de asistencia existente si la hay. A diferencia de
 * `attendanceForSession` (solo filas YA marcadas, usada en el export), esta
 * incluye a quienes aún no tienen ninguna marca (`present: null`).
 */
export async function rosterForSession(principal: Principal, sessionId: string): Promise<RosterRow[] | null> {
  if (!principal.tenantId || !canView(principal)) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  const { data: session } = await guard.db
    .from("live_sessions")
    .select("id, action_id")
    .eq("tenant_id", tenantId)
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return null;

  const [{ data: roster }, { data: attendance }] = await Promise.all([
    guard.db
      .from("enrollments")
      .select("id, first_names, last_names")
      .eq("tenant_id", tenantId)
      .eq("action_id", session.action_id),
    guard.db
      .from("live_session_attendance")
      .select("enrollment_id, present, source, note")
      .eq("tenant_id", tenantId)
      .eq("session_id", sessionId),
  ]);
  const attendanceById = new Map(
    ((attendance ?? []) as { enrollment_id: string; present: boolean; source: string; note: string }[]).map((a) => [
      a.enrollment_id,
      a,
    ]),
  );

  return ((roster ?? []) as { id: string; first_names: string | null; last_names: string | null }[])
    .map((e) => {
      const a = attendanceById.get(e.id);
      return {
        enrollmentId: e.id,
        nombres: e.first_names ?? "",
        apellidos: e.last_names ?? "",
        present: a ? a.present : null,
        source: (a?.source as "self" | "manual" | undefined) ?? null,
        note: a?.note ?? "",
      };
    })
    .sort((a, b) => `${a.apellidos} ${a.nombres}`.localeCompare(`${b.apellidos} ${b.nombres}`));
}

export interface AttendanceRow {
  readonly enrollmentId: string;
  readonly nombres: string;
  readonly apellidos: string;
  readonly present: boolean;
  readonly source: "self" | "manual";
  readonly note: string;
  readonly markedAtMs: number;
}

interface RawAttendanceRow {
  enrollment_id: string;
  present: boolean;
  source: string;
  note: string;
  marked_at: string;
}

/** Roster de asistencia de una sesión con nombre/apellido (staff). */
export async function attendanceForSession(principal: Principal, sessionId: string): Promise<AttendanceRow[] | null> {
  if (!principal.tenantId || !canView(principal)) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  const { data: session } = await guard.db
    .from("live_sessions")
    .select("id, action_id")
    .eq("tenant_id", tenantId)
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return null;

  const [{ data: attendance }, { data: roster }] = await Promise.all([
    guard.db
      .from("live_session_attendance")
      .select("enrollment_id, present, source, note, marked_at")
      .eq("tenant_id", tenantId)
      .eq("session_id", sessionId),
    guard.db
      .from("enrollments")
      .select("id, first_names, last_names")
      .eq("tenant_id", tenantId)
      .eq("action_id", session.action_id),
  ]);
  const nameById = new Map(
    ((roster ?? []) as { id: string; first_names: string | null; last_names: string | null }[]).map((e) => [e.id, e]),
  );

  return ((attendance ?? []) as RawAttendanceRow[])
    .map((a) => {
      const e = nameById.get(a.enrollment_id);
      return {
        enrollmentId: a.enrollment_id,
        nombres: e?.first_names ?? "",
        apellidos: e?.last_names ?? "",
        present: a.present,
        source: a.source as "self" | "manual",
        note: a.note ?? "",
        markedAtMs: Date.parse(a.marked_at),
      };
    })
    .sort((a, b) => `${a.apellidos} ${a.nombres}`.localeCompare(`${b.apellidos} ${b.nombres}`));
}

/** Export CSV (disclaimer + cabeceras + filas), listo para el route handler. */
export async function exportAttendanceCsv(
  principal: Principal,
  sessionId: string,
): Promise<{ filename: string; csv: string } | null> {
  const rows = await attendanceForSession(principal, sessionId);
  if (rows === null) return null;
  const csvRows: AttendanceCsvRow[] = rows.map((r) => ({
    nombres: r.nombres,
    apellidos: r.apellidos,
    present: r.present,
    source: r.source,
    note: r.note,
    markedAt: formatMarkedAt(r.markedAtMs),
  }));
  return { filename: `asistencia-interna-${sessionId}`, csv: attendanceCsv(csvRows) };
}
