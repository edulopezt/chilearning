// ⚠ SIN `import "server-only"`: lo ejecuta también el proceso worker (job
// `reminders-tick`), que corre fuera de Next (mismo criterio que `sence/expiry.ts`).
import type { SupabaseClient } from "@supabase/supabase-js";

import { isFeatureEnabled } from "../core/domain/features";
import { buildN8nEvent, type AutomationKind } from "./domain/automation";
import { renderReminderEmail } from "./domain/email-templates";
import {
  coordinatorReport,
  selectInactive,
  selectNoAttendance,
  type ReminderEnrollment,
  type ReminderTarget,
} from "./domain/reminders-rules";
import {
  AVISO_INACTIVO_V1,
  buildAvisoInactivoParams,
  buildRecordatorioAsistenciaParams,
  RECORDATORIO_ASISTENCIA_V1,
} from "./domain/whatsapp-templates";
import type { EmailSender } from "./email-sender";
import type { N8nEmitter } from "./n8n-webhook";
import type { WhatsAppSender } from "./whatsapp-sender";

/**
 * Job de recordatorios (task 3.9, HU-5.9). Corre en el worker (fino en index.ts).
 * Inyectable y testeable sin Redis/red. Boundary P3: error-rate(2.6) y día-1(2.7)
 * NO se duplican; esto son recordatorios NUEVOS. Flujo por acción con config
 * habilitada: computa objetivos (reglas puras, SIN opt-out de ningún canal —
 * ver `reminders-rules.ts`) → por cada target, envía correo PII por EmailSender
 * al destinatario real SI no se dio de baja de EMAIL → registra en la outbox
 * (dedup diario) → emite a n8n SOLO el agregado seudonimizado (RNF-10).
 *
 * Canal WhatsApp (task 5.11, D-049 — extiende a Meta el mismo principio que
 * D-042 sentó para el correo): bloque HERMANO al de email dentro del mismo
 * loop de `dispatch()`. Envío DIRECTO a Meta vía `WhatsAppSender` — jamás por
 * n8n (n8n nunca ve un teléfono). Gateado por: feature `whatsapp` del tenant
 * (una consulta por tenant por tick, cacheada — no por alumno), `r.phone`
 * presente, `deps.whatsappSender.configured`, y el opt-out de ESTE alumno
 * para ESTE canal (`optedOutWhatsapp`, columna separada del `optedOut` de
 * email, `communication_opt_outs` único por `(tenant_id, user_id, channel)`).
 *
 * Independencia REAL entre canales (fix de la revisión adversarial de esta
 * task): `targets` ya NO viene filtrado por opt-out de ningún canal — cada
 * rama de `dispatch()` (email/WhatsApp) chequea SOLO el opt-out de SU propio
 * canal (`optedOutEmailByUser`/`optedOutWhatsappByUser`, ambos derivados de
 * `loadEnrollmentData`). Antes, `selectNoAttendance`/`selectInactive`
 * filtraban por el opt-out de EMAIL antes de que el bloque WhatsApp pudiera
 * evaluarse: un alumno dado de baja SOLO de email nunca llegaba a `targets` y
 * por lo tanto tampoco recibía WhatsApp, aunque nunca se hubiera dado de baja
 * de ESE canal. Ver `reminders-rules.ts` (`eligible()`) para el detalle.
 */

export interface RemindersDeps {
  readonly now: number;
  readonly secret: string;
  readonly emailSender: EmailSender;
  /** Canal WhatsApp (task 5.11). Con `whatsappSenderFromEnv` sin credenciales,
   *  degrada a no-op — el job sigue corriendo igual (mismo patrón que email). */
  readonly whatsappSender: WhatsAppSender;
  readonly n8n: N8nEmitter;
  /** Resuelve correo+nombre+teléfono por user_id (producción: admin API; tests: stub).
   *  `phone` es `null` cuando el alumno no tiene teléfono en `user_metadata` (hoy
   *  ningún flujo lo puebla salvo que el import CSV traiga la columna opcional
   *  — ver `docs/whatsapp/ACTIVATION.md`). */
  readonly resolveRecipients: (
    userIds: readonly string[],
  ) => Promise<Map<string, { email: string; name: string; phone: string | null }>>;
  readonly inactiveDays?: number;
  /** Base URL absoluta para los enlaces del correo (el worker no tiene origin;
   *  4-ojos MED: un enlace relativo no es clickeable en el cliente de correo). */
  readonly appBaseUrl?: string;
}

export interface RemindersSummary {
  readonly actions: number;
  readonly emailsSent: number;
  readonly whatsappSent: number;
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

  const [{ data: sessions }, { data: progress }, { data: optOuts }, { data: optOutsWhatsapp }] = await Promise.all([
    db.from("sence_sessions").select("enrollment_id, opened_at").eq("tenant_id", tenantId).in("enrollment_id", ids).gte("opened_at", dayStartIso),
    db.from("lesson_progress").select("enrollment_id, updated_at").eq("tenant_id", tenantId).in("enrollment_id", ids),
    db.from("communication_opt_outs").select("user_id").eq("tenant_id", tenantId).eq("channel", "email").in("user_id", users),
    // Consulta SEPARADA (task 5.11): el opt-out de WhatsApp es independiente
    // del de email — jamás se mezclan en un solo Set.
    db.from("communication_opt_outs").select("user_id").eq("tenant_id", tenantId).eq("channel", "whatsapp").in("user_id", users),
  ]);
  const attendedToday = new Set((sessions ?? []).filter((s) => s.opened_at).map((s) => s.enrollment_id as string));
  const lastActivity = new Map<string, number>();
  for (const p of progress ?? []) {
    const ms = Date.parse(p.updated_at as string);
    const cur = lastActivity.get(p.enrollment_id as string);
    if (cur === undefined || ms > cur) lastActivity.set(p.enrollment_id as string, ms);
  }
  const optedOut = new Set((optOuts ?? []).map((o) => o.user_id as string));
  const optedOutWhatsapp = new Set((optOutsWhatsapp ?? []).map((o) => o.user_id as string));

  return rows.map((e) => {
    const last = lastActivity.get(e.id as string);
    return {
      enrollmentId: e.id as string,
      userId: e.user_id as string,
      exento: Boolean(e.exento),
      attendedToday: attendedToday.has(e.id as string),
      lastActivityDaysAgo: last === undefined ? null : Math.floor((nowMs - last) / DAY_MS),
      optedOut: optedOut.has(e.user_id as string),
      optedOutWhatsapp: optedOutWhatsapp.has(e.user_id as string),
    };
  });
}

/** Feature `whatsapp` del tenant (task 5.3), cacheada por tick para no repetir
 *  la consulta por cada acción del mismo tenant (ni menos por cada alumno).
 *  Consulta DIRECTA a `tenants.flags` (no `requireFeature`/`tenantGuard`): esos
 *  helpers importan `"server-only"`, que rompe el bundle del worker (esbuild
 *  no resuelve ese paquete fuera de Next) — mismo motivo por el que este
 *  archivo entero evita esa importación (ver el comentario del inicio). */
async function tenantWhatsappEnabled(db: SupabaseClient, tenantId: string, cache: Map<string, boolean>): Promise<boolean> {
  const cached = cache.get(tenantId);
  if (cached !== undefined) return cached;
  const { data } = await db.from("tenants").select("flags").eq("id", tenantId).maybeSingle();
  const enabled = isFeatureEnabled(data?.flags, "whatsapp");
  cache.set(tenantId, enabled);
  return enabled;
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
  // Task 5.11: flag `whatsapp` del tenant, ya resuelto UNA VEZ por
  // `runRemindersTick` (no se re-consulta por alumno ni por llamado a dispatch).
  whatsappEnabled: boolean,
  // Fix revisión adversarial (task 5.11): opt-out de EMAIL por userId, evaluado
  // AQUÍ (no en las reglas de selección) para que sea simétrico con
  // `optedOutWhatsappByUser` — un opt-out de un canal nunca excluye al alumno
  // del otro.
  optedOutEmailByUser: ReadonlyMap<string, boolean>,
  // Task 5.11: opt-out INDEPENDIENTE del de email, por userId (de `loadEnrollmentData`).
  optedOutWhatsappByUser: ReadonlyMap<string, boolean>,
  // Task 5.9 (HU-5.9): personalización DETERMINÍSTICA del correo `inactive`
  // con `lastActivityDaysAgo` (ya calculado por `loadEnrollmentData`, cero IA
  // en el envío automático). Solo el llamador del kind "inactive" lo pasa; el
  // de "no_attendance" lo omite y el email queda IDÉNTICO al de siempre.
  lastActivityByUser?: ReadonlyMap<string, number | null>,
): Promise<{ emails: number; whatsapp: number; emitted: boolean }> {
  if (targets.length === 0) return { emails: 0, whatsapp: 0, emitted: false };
  const recipients = await deps.resolveRecipients(targets.map((t) => t.userId));
  let emails = 0;
  let whatsapp = 0;
  for (const t of targets) {
    const r = recipients.get(t.userId);
    // Outbox + dedup: registra el recordatorio con `created_at = now del tick` para
    // que la ventana "hoy" sea determinista respecto a `deps.now` (no al reloj real).
    await db.from("notifications").insert({ tenant_id: ctx.tenantId, user_id: t.userId, kind: `reminder.${kind}`, payload: { actionId: ctx.actionId }, created_at: new Date(deps.now).toISOString() });
    // Fix revisión adversarial (task 5.11): gate SIMÉTRICO al de WhatsApp de
    // abajo — el opt-out de EMAIL de ESTE alumno se chequea aquí, no aguas
    // arriba, para no interferir con el bloque WhatsApp de otro canal.
    if (r?.email && deps.emailSender.configured && !optedOutEmailByUser.get(t.userId)) {
      const lastActivityDaysAgo = lastActivityByUser?.get(t.userId);
      const email = renderReminderEmail({
        brand: { orgName: ctx.courseName, primaryColor: "#1e3a8a" },
        recipientName: r.name,
        kind,
        courseName: ctx.courseName,
        courseUrl: ctx.courseUrl,
        // `null` (nunca tuvo actividad) se omite a propósito: "hace null días" no
        // es una frase honesta -- mejor sin la línea que con un dato incorrecto.
        ...(typeof lastActivityDaysAgo === "number" ? { lastActivityDaysAgo } : {}),
      });
      const sent = await deps.emailSender.send({ to: r.email, subject: email.subject, html: email.html, text: email.text });
      if (sent.ok) emails++;
    }
    // Bloque HERMANO al de email (task 5.11, D-049): directo a Meta, jamás por
    // n8n. Gateado por flag de tenant + teléfono presente + sender configurado
    // + opt-out WhatsApp (independiente del de email, evaluado simétrico al
    // gate de email de arriba) de ESTE alumno.
    if (whatsappEnabled && r?.phone && deps.whatsappSender.configured && !optedOutWhatsappByUser.get(t.userId)) {
      const template = kind === "no_attendance" ? RECORDATORIO_ASISTENCIA_V1 : AVISO_INACTIVO_V1;
      const bodyParams =
        kind === "no_attendance"
          ? buildRecordatorioAsistenciaParams(r.name, ctx.courseName)
          : buildAvisoInactivoParams(r.name, ctx.courseName);
      const waSent = await deps.whatsappSender.send({
        to: r.phone,
        templateName: template.name,
        languageCode: template.languageCode,
        bodyParams,
      });
      if (waSent.ok) whatsapp++;
    }
  }
  // A n8n: SOLO seudónimos + conteo (RNF-10).
  const event = buildN8nEvent(deps.secret, { kind, tenantId: ctx.tenantId, actionId: ctx.actionId, recipientUserIds: targets.map((t) => t.userId), at: new Date(deps.now).toISOString() });
  const res = await deps.n8n.emit(event);
  return { emails, whatsapp, emitted: res.ok };
}

export async function runRemindersTick(db: SupabaseClient, deps: RemindersDeps): Promise<RemindersSummary> {
  const dayStartIso = startOfDayIso(deps.now);
  const { data: configs } = await db.from("automation_config").select("tenant_id, action_id, kind, enabled, settings").eq("enabled", true);
  const enabled = configs ?? [];
  if (enabled.length === 0) return { actions: 0, emailsSent: 0, whatsappSent: 0, n8nEvents: 0 };

  // Agrupa kinds habilitados por acción.
  const byAction = new Map<string, { tenantId: string; actionId: string; kinds: Map<AutomationKind, Record<string, unknown>> }>();
  for (const c of enabled) {
    const key = c.action_id as string;
    if (!byAction.has(key)) byAction.set(key, { tenantId: c.tenant_id as string, actionId: key, kinds: new Map() });
    byAction.get(key)!.kinds.set(c.kind as AutomationKind, (c.settings ?? {}) as Record<string, unknown>);
  }

  let emailsSent = 0;
  let whatsappSent = 0;
  let n8nEvents = 0;
  let actionsProcessed = 0;
  // Cache del flag `whatsapp` por tenant: varias acciones pueden compartir
  // tenant en el mismo tick — se consulta como máximo una vez cada uno.
  const whatsappFlagCache = new Map<string, boolean>();

  for (const { tenantId, actionId, kinds } of byAction.values()) {
    const { data: action } = await db.from("actions").select("id, course_id").eq("tenant_id", tenantId).eq("id", actionId).maybeSingle();
    if (!action) continue;
    const { data: course } = await db.from("courses").select("name").eq("tenant_id", tenantId).eq("id", action.course_id as string).maybeSingle();
    const courseName = (course?.name as string) ?? "Tu curso";
    const base = (deps.appBaseUrl ?? "").replace(/\/$/, "");
    const ctx = { tenantId, actionId, courseName, courseUrl: `${base}/mi-curso` };

    const enrollments = await loadEnrollmentData(db, tenantId, actionId, dayStartIso, deps.now);
    if (enrollments.length === 0) continue;
    actionsProcessed++;
    const sent = await alreadySentToday(db, tenantId, enrollments.map((e) => e.userId), dayStartIso);
    const whatsappEnabled = await tenantWhatsappEnabled(db, tenantId, whatsappFlagCache);
    // Fix revisión adversarial (task 5.11): mapa SIMÉTRICO al de WhatsApp, por
    // canal — `targets` ya no viene filtrado por opt-out (ver `reminders-rules.ts`),
    // así que cada rama de `dispatch()` filtra por el opt-out de SU propio canal.
    const optedOutEmailByUser = new Map(enrollments.map((e) => [e.userId, e.optedOut]));
    const optedOutWhatsappByUser = new Map(enrollments.map((e) => [e.userId, e.optedOutWhatsapp]));

    if (kinds.has("no_attendance")) {
      const r = await dispatch(db, deps, ctx, "no_attendance", selectNoAttendance(enrollments, sent), whatsappEnabled, optedOutEmailByUser, optedOutWhatsappByUser);
      emailsSent += r.emails;
      whatsappSent += r.whatsapp;
      if (r.emitted) n8nEvents++;
    }
    if (kinds.has("inactive")) {
      const days = Number((kinds.get("inactive") as { inactiveDays?: number })?.inactiveDays ?? deps.inactiveDays ?? 7);
      const lastActivityByUser = new Map(enrollments.map((e) => [e.userId, e.lastActivityDaysAgo]));
      const r = await dispatch(db, deps, ctx, "inactive", selectInactive(enrollments, days, sent), whatsappEnabled, optedOutEmailByUser, optedOutWhatsappByUser, lastActivityByUser);
      emailsSent += r.emails;
      whatsappSent += r.whatsapp;
      if (r.emitted) n8nEvents++;
    }
    if (kinds.has("coordinator_report")) {
      const report = coordinatorReport(enrollments, Number(deps.inactiveDays ?? 7));
      const event = { ...buildN8nEvent(deps.secret, { kind: "coordinator_report" as AutomationKind, tenantId, actionId, recipientUserIds: [], at: new Date(deps.now).toISOString() }), report };
      const res = await deps.n8n.emit(event);
      if (res.ok) n8nEvents++;
    }
  }

  return { actions: actionsProcessed, emailsSent, whatsappSent, n8nEvents };
}
