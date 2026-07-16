// ⚠ SIN `import "server-only"`: lo ejecuta también el proceso worker (job
// `reminders-tick`), que corre fuera de Next (mismo criterio que `sence/expiry.ts`).
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildN8nEvent, type AutomationKind } from "./domain/automation";
import { renderReminderEmail } from "./domain/email-templates";
import {
  coordinatorReport,
  selectInactive,
  selectNoAttendance,
  type ReminderEnrollment,
  type ReminderTarget,
} from "./domain/reminders-rules";
import type { EmailSender } from "./email-sender";
import type { N8nEmitter } from "./n8n-webhook";

/**
 * Job de recordatorios (task 3.9, HU-5.9). Corre en el worker (fino en index.ts).
 * Inyectable y testeable sin Redis/red. Boundary P3: error-rate(2.6) y día-1(2.7)
 * NO se duplican; esto son recordatorios NUEVOS. Flujo por acción con config
 * habilitada: computa objetivos (reglas puras) → envía correo PII por EmailSender
 * al destinatario real (honra opt-out) → registra en la outbox (dedup diario) →
 * emite a n8n SOLO el agregado seudonimizado (RNF-10).
 */

export interface RemindersDeps {
  readonly now: number;
  readonly secret: string;
  readonly emailSender: EmailSender;
  readonly n8n: N8nEmitter;
  /** Resuelve correo+nombre por user_id (producción: admin API; tests: stub). */
  readonly resolveRecipients: (userIds: readonly string[]) => Promise<Map<string, { email: string; name: string }>>;
  readonly inactiveDays?: number;
}

export interface RemindersSummary {
  readonly actions: number;
  readonly emailsSent: number;
  readonly n8nEvents: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDayIso(nowMs: number): string {
  return new Date(new Date(nowMs).toISOString().slice(0, 10) + "T00:00:00.000Z").toISOString();
}

async function loadEnrollmentData(
  db: SupabaseClient,
  tenantId: string,
  actionId: string,
  dayStartIso: string,
  nowMs: number,
): Promise<ReminderEnrollment[]> {
  const { data: enrollments } = await db.from("enrollments").select("id, user_id, exento").eq("tenant_id", tenantId).eq("action_id", actionId);
  const rows = enrollments ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((e) => e.id as string);
  const users = rows.map((e) => e.user_id as string);

  const [{ data: sessions }, { data: progress }, { data: optOuts }] = await Promise.all([
    db.from("sence_sessions").select("enrollment_id, opened_at").eq("tenant_id", tenantId).in("enrollment_id", ids).gte("opened_at", dayStartIso),
    db.from("lesson_progress").select("enrollment_id, updated_at").eq("tenant_id", tenantId).in("enrollment_id", ids),
    db.from("communication_opt_outs").select("user_id").eq("tenant_id", tenantId).eq("channel", "email").in("user_id", users),
  ]);
  const attendedToday = new Set((sessions ?? []).filter((s) => s.opened_at).map((s) => s.enrollment_id as string));
  const lastActivity = new Map<string, number>();
  for (const p of progress ?? []) {
    const ms = Date.parse(p.updated_at as string);
    const cur = lastActivity.get(p.enrollment_id as string);
    if (cur === undefined || ms > cur) lastActivity.set(p.enrollment_id as string, ms);
  }
  const optedOut = new Set((optOuts ?? []).map((o) => o.user_id as string));

  return rows.map((e) => {
    const last = lastActivity.get(e.id as string);
    return {
      enrollmentId: e.id as string,
      userId: e.user_id as string,
      exento: Boolean(e.exento),
      attendedToday: attendedToday.has(e.id as string),
      lastActivityDaysAgo: last === undefined ? null : Math.floor((nowMs - last) / DAY_MS),
      optedOut: optedOut.has(e.user_id as string),
    };
  });
}

async function alreadySentToday(db: SupabaseClient, tenantId: string, users: readonly string[], dayStartIso: string): Promise<Set<string>> {
  if (users.length === 0) return new Set();
  const { data } = await db
    .from("notifications")
    .select("user_id, kind")
    .eq("tenant_id", tenantId)
    .in("user_id", users as string[])
    .gte("created_at", dayStartIso)
    .like("kind", "reminder.%");
  return new Set((data ?? []).map((n) => `${(n.kind as string).replace("reminder.", "")}:${n.user_id as string}`));
}

async function dispatch(
  db: SupabaseClient,
  deps: RemindersDeps,
  ctx: { tenantId: string; actionId: string; courseName: string; courseUrl: string },
  kind: Extract<AutomationKind, "no_attendance" | "inactive">,
  targets: readonly ReminderTarget[],
): Promise<{ emails: number; emitted: boolean }> {
  if (targets.length === 0) return { emails: 0, emitted: false };
  const recipients = await deps.resolveRecipients(targets.map((t) => t.userId));
  let emails = 0;
  for (const t of targets) {
    const r = recipients.get(t.userId);
    // Outbox + dedup: registra el recordatorio con `created_at = now del tick` para
    // que la ventana "hoy" sea determinista respecto a `deps.now` (no al reloj real).
    await db.from("notifications").insert({ tenant_id: ctx.tenantId, user_id: t.userId, kind: `reminder.${kind}`, payload: { actionId: ctx.actionId }, created_at: new Date(deps.now).toISOString() });
    if (r?.email && deps.emailSender.configured) {
      const email = renderReminderEmail({ brand: { orgName: ctx.courseName, primaryColor: "#1e3a8a" }, recipientName: r.name, kind, courseName: ctx.courseName, courseUrl: ctx.courseUrl });
      const sent = await deps.emailSender.send({ to: r.email, subject: email.subject, html: email.html, text: email.text });
      if (sent.ok) emails++;
    }
  }
  // A n8n: SOLO seudónimos + conteo (RNF-10).
  const event = buildN8nEvent(deps.secret, { kind, tenantId: ctx.tenantId, actionId: ctx.actionId, recipientUserIds: targets.map((t) => t.userId), at: new Date(deps.now).toISOString() });
  const res = await deps.n8n.emit(event);
  return { emails, emitted: res.ok };
}

export async function runRemindersTick(db: SupabaseClient, deps: RemindersDeps): Promise<RemindersSummary> {
  const dayStartIso = startOfDayIso(deps.now);
  const { data: configs } = await db.from("automation_config").select("tenant_id, action_id, kind, enabled, settings").eq("enabled", true);
  const enabled = configs ?? [];
  if (enabled.length === 0) return { actions: 0, emailsSent: 0, n8nEvents: 0 };

  // Agrupa kinds habilitados por acción.
  const byAction = new Map<string, { tenantId: string; actionId: string; kinds: Map<AutomationKind, Record<string, unknown>> }>();
  for (const c of enabled) {
    const key = c.action_id as string;
    if (!byAction.has(key)) byAction.set(key, { tenantId: c.tenant_id as string, actionId: key, kinds: new Map() });
    byAction.get(key)!.kinds.set(c.kind as AutomationKind, (c.settings ?? {}) as Record<string, unknown>);
  }

  let emailsSent = 0;
  let n8nEvents = 0;
  let actionsProcessed = 0;

  for (const { tenantId, actionId, kinds } of byAction.values()) {
    const { data: action } = await db.from("actions").select("id, course_id").eq("tenant_id", tenantId).eq("id", actionId).maybeSingle();
    if (!action) continue;
    const { data: course } = await db.from("courses").select("name").eq("tenant_id", tenantId).eq("id", action.course_id as string).maybeSingle();
    const courseName = (course?.name as string) ?? "Tu curso";
    const ctx = { tenantId, actionId, courseName, courseUrl: `/mi-curso` };

    const enrollments = await loadEnrollmentData(db, tenantId, actionId, dayStartIso, deps.now);
    if (enrollments.length === 0) continue;
    actionsProcessed++;
    const sent = await alreadySentToday(db, tenantId, enrollments.map((e) => e.userId), dayStartIso);

    if (kinds.has("no_attendance")) {
      const r = await dispatch(db, deps, ctx, "no_attendance", selectNoAttendance(enrollments, sent));
      emailsSent += r.emails;
      if (r.emitted) n8nEvents++;
    }
    if (kinds.has("inactive")) {
      const days = Number((kinds.get("inactive") as { inactiveDays?: number })?.inactiveDays ?? deps.inactiveDays ?? 7);
      const r = await dispatch(db, deps, ctx, "inactive", selectInactive(enrollments, days, sent));
      emailsSent += r.emails;
      if (r.emitted) n8nEvents++;
    }
    if (kinds.has("coordinator_report")) {
      const report = coordinatorReport(enrollments, Number(deps.inactiveDays ?? 7));
      const event = { ...buildN8nEvent(deps.secret, { kind: "coordinator_report" as AutomationKind, tenantId, actionId, recipientUserIds: [], at: new Date(deps.now).toISOString() }), report };
      const res = await deps.n8n.emit(event);
      if (res.ok) n8nEvents++;
    }
  }

  return { actions: actionsProcessed, emailsSent, n8nEvents };
}
