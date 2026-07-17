// ⚠ SIN `import "server-only"`: lo ejecuta el proceso worker (job
// `expiry-alerts-tick`), fuera de Next. Imports RELATIVOS (el bundle de esbuild
// no resuelve el alias `@/`) y NADA que arrastre `server-only` (tenant-guard,
// audit y reportes/xlsx lo tienen). Mismo patrón que `comunicacion/reminders.ts`.
import type { SupabaseClient } from "@supabase/supabase-js";

import { renderCertificateExpiringEmail } from "../comunicacion/domain/email-templates";
import type { EmailSender } from "../comunicacion/email-sender";
import type { N8nEmitter } from "../comunicacion/n8n-webhook";
import {
  buildExpiryN8nEvent,
  daysUntil,
  dueOffset,
  offsetsToMark,
  sanitizeOffsets,
  DEFAULT_EXPIRY_OFFSETS,
} from "./domain/expiry";
import { formatExpiryDate } from "./domain/expiry-report";

/**
 * Job de alertas de recertificación (task 5.12, HU-7.3). Corre en el worker
 * (wiring fino en `src/worker/index.ts`), inyectable y testeable sin Redis/red.
 *
 * Flujo por tenant con alertas habilitadas: certificados VIGENTES con
 * vencimiento dentro de la ventana máxima → `dueOffset` decide qué aviso toca →
 * LEDGER-FIRST → aviso in-app + correo best-effort al alumno → n8n recibe SOLO
 * el agregado seudonimizado por (tenant, curso, offset).
 *
 * ⚠ LEDGER-FIRST es lo que da la idempotencia. Se insertan TODAS las filas de
 * `offsetsToMark` (el due y los mayores) ANTES de notificar, tolerando el 23505
 * del unique `(certificate_id, offset_days)`. Consecuencias, ambas queridas:
 *  - Si el tick corre dos veces, la 2ª ve el 23505 y NO reenvía nada.
 *  - Si el proceso muere entre el insert y el correo, se pierde UN aviso. Es el
 *    trade-off correcto: al alumno le quedan 30/60 días y el listado del
 *    coordinador lo sigue mostrando; duplicar correos, en cambio, es spam
 *    irreversible (y aquí no hay transacción entre Postgres y Resend).
 */

export interface ExpiryAlertsDeps {
  readonly now: number;
  readonly secret: string;
  readonly emailSender: EmailSender;
  readonly n8n: N8nEmitter;
  /** Resuelve correo+nombre por user_id (producción: admin API; tests: stub). */
  readonly resolveRecipients: (userIds: readonly string[]) => Promise<Map<string, { email: string; name: string }>>;
  /** Base URL absoluta para los enlaces del correo (el worker no tiene origin). */
  readonly appBaseUrl?: string;
}

export interface ExpiryAlertsSummary {
  readonly tenants: number;
  readonly certificates: number;
  readonly notified: number;
  readonly emailsSent: number;
  readonly n8nEvents: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 1000;
const IN_CHUNK = 100;

interface TenantConfig {
  readonly tenantId: string;
  readonly offsets: number[];
}

/**
 * Tenants a procesar. "Sin fila de config" = defaults HABILITADOS (90/60/30):
 * la vigencia no debe depender de que alguien se acuerde de encender el aviso.
 * `enabled = false` es una decisión EXPLÍCITA y saca al tenant del barrido.
 */
async function tenantsToProcess(db: SupabaseClient): Promise<TenantConfig[]> {
  const { data: tenants } = await db.from("tenants").select("id");
  const { data: configs } = await db.from("certificate_expiry_config").select("tenant_id, offsets_days, enabled");
  const byTenant = new Map((configs ?? []).map((c) => [c.tenant_id as string, c]));

  const out: TenantConfig[] = [];
  for (const t of tenants ?? []) {
    const tenantId = t.id as string;
    const cfg = byTenant.get(tenantId);
    if (cfg && cfg.enabled === false) continue;
    out.push({
      tenantId,
      offsets: cfg ? sanitizeOffsets(cfg.offsets_days) : [...DEFAULT_EXPIRY_OFFSETS],
    });
  }
  return out;
}

interface CertRow {
  id: string;
  enrollment_id: string;
  course_id: string;
  expires_at: string;
}

/** Certificados vigentes del tenant que vencen dentro de la ventana máxima. */
async function certificatesInWindow(
  db: SupabaseClient,
  tenantId: string,
  now: number,
  maxOffset: number,
): Promise<CertRow[]> {
  const out: CertRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await db
      .from("certificates")
      // Sin `snapshot`: lleva el RUN completo (D-030) y aquí no hace falta.
      .select("id, enrollment_id, course_id, expires_at")
      // ⚠ SIEMPRE con `.eq("tenant_id", …)`: este cliente es service-role y
      // bypassa RLS. Sin esto el job cruzaría tenants.
      .eq("tenant_id", tenantId)
      .eq("status", "issued")
      .not("expires_at", "is", null)
      // [now, now + maxOffset]: lo ya vencido NO entra (no se le notifica; sí
      // aparece en el listado del coordinador).
      .gte("expires_at", new Date(now).toISOString())
      .lte("expires_at", new Date(now + maxOffset * DAY_MS).toISOString())
      .order("expires_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    const rows = (data ?? []) as CertRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Inscripción → titular, para el correo y el aviso in-app. */
async function enrollmentOwners(
  db: SupabaseClient,
  tenantId: string,
  enrollmentIds: readonly string[],
): Promise<Map<string, { userId: string }>> {
  const out = new Map<string, { userId: string }>();
  for (let i = 0; i < enrollmentIds.length; i += IN_CHUNK) {
    const { data } = await db
      .from("enrollments")
      .select("id, user_id")
      .eq("tenant_id", tenantId)
      .in("id", enrollmentIds.slice(i, i + IN_CHUNK));
    for (const e of data ?? []) out.set(e.id as string, { userId: e.user_id as string });
  }
  return out;
}

async function optedOutEmails(
  db: SupabaseClient,
  tenantId: string,
  userIds: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < userIds.length; i += IN_CHUNK) {
    const { data } = await db
      .from("communication_opt_outs")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("channel", "email")
      .in("user_id", userIds.slice(i, i + IN_CHUNK));
    for (const o of data ?? []) out.add(o.user_id as string);
  }
  return out;
}

/**
 * Avisos YA registrados, como claves `certId|offset`. Una consulta por lote.
 *
 * Es un ATAJO, no la garantía: la garantía sigue siendo el unique del ledger
 * (`claimAlert` tolera el 23505). Sin este pre-chequeo, cada tick reintentaba
 * 1–3 inserts CONDENADOS por cada certificado de la ventana, para siempre: con
 * 10.000 certificados vigentes eso son ~30.000 inserts fallidos cada 6 h. Con
 * él, el estado estacionario cuesta un select y CERO escrituras.
 */
async function existingAlerts(
  db: SupabaseClient,
  tenantId: string,
  certIds: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < certIds.length; i += IN_CHUNK) {
    const { data } = await db
      .from("certificate_expiry_alerts")
      .select("certificate_id, offset_days")
      .eq("tenant_id", tenantId)
      .in("certificate_id", certIds.slice(i, i + IN_CHUNK));
    for (const a of data ?? []) out.add(`${a.certificate_id as string}|${a.offset_days as number}`);
  }
  return out;
}

/**
 * Reserva el aviso en el ledger. Devuelve true solo si ESTE tick ganó el
 * `due` (o sea: hay que notificar). El 23505 del unique = "ya estaba avisado".
 */
async function claimAlert(
  db: SupabaseClient,
  tenantId: string,
  certificateId: string,
  due: number,
  offsets: readonly number[],
  sentAtIso: string,
): Promise<boolean> {
  let claimed = false;
  // El `due` primero: es el único cuyo resultado decide si se notifica.
  for (const offset of [due, ...offsetsToMark(due, offsets).filter((o) => o !== due)]) {
    const { error } = await db.from("certificate_expiry_alerts").insert({
      tenant_id: tenantId,
      certificate_id: certificateId,
      offset_days: offset,
      sent_at: sentAtIso,
    });
    if (offset === due) claimed = !error;
    // Un error que NO sea 23505 (unique) se ignora aquí a propósito: el ledger
    // es best-effort para los offsets MAYORES (solo evitan la ráfaga). Si falla
    // el del `due`, `claimed` es false y no se notifica: fallar cerrado.
  }
  return claimed;
}

export async function runExpiryAlertsTick(
  db: SupabaseClient,
  deps: ExpiryAlertsDeps,
): Promise<ExpiryAlertsSummary> {
  const nowIso = new Date(deps.now).toISOString();
  const tenants = await tenantsToProcess(db);

  let certificates = 0;
  let notified = 0;
  let emailsSent = 0;
  let n8nEvents = 0;
  let tenantsProcessed = 0;

  for (const { tenantId, offsets } of tenants) {
    const maxOffset = offsets[0] ?? 90; // `sanitizeOffsets` garantiza desc y no vacío.
    const certs = await certificatesInWindow(db, tenantId, deps.now, maxOffset);
    if (certs.length === 0) continue;
    tenantsProcessed++;
    certificates += certs.length;

    const owners = await enrollmentOwners(db, tenantId, [...new Set(certs.map((c) => c.enrollment_id))]);
    const optedOut = await optedOutEmails(db, tenantId, [...new Set([...owners.values()].map((o) => o.userId))]);

    // Nombre del curso: una sola consulta por tenant (no una por certificado).
    const courseIds = [...new Set(certs.map((c) => c.course_id))];
    const courseName = new Map<string, string>();
    for (let i = 0; i < courseIds.length; i += IN_CHUNK) {
      const { data } = await db.from("courses").select("id, name").eq("tenant_id", tenantId).in("id", courseIds.slice(i, i + IN_CHUNK));
      for (const c of data ?? []) courseName.set(c.id as string, c.name as string);
    }

    const brand = await loadBrand(db, tenantId);
    const base = (deps.appBaseUrl ?? "").replace(/\/$/, "");
    const certificatesUrl = `${base}/mi-curso/certificados`;

    // Destinatarios a notificar, y el agregado por (curso, offset) para n8n.
    const alreadySent = await existingAlerts(db, tenantId, certs.map((c) => c.id));
    const toNotify: { cert: CertRow; userId: string; due: number }[] = [];
    for (const cert of certs) {
      const due = dueOffset(cert.expires_at, deps.now, offsets);
      if (due === null) continue;
      // Ya avisado: ni siquiera se intenta el insert (ver `existingAlerts`).
      if (alreadySent.has(`${cert.id}|${due}`)) continue;
      const owner = owners.get(cert.enrollment_id);
      if (!owner) continue;
      // LEDGER-FIRST: reservar ANTES de notificar (ver cabecera).
      const claimed = await claimAlert(db, tenantId, cert.id, due, offsets, nowIso);
      if (!claimed) continue;
      toNotify.push({ cert, userId: owner.userId, due });
    }

    const recipients = toNotify.length > 0
      ? await deps.resolveRecipients([...new Set(toNotify.map((t) => t.userId))])
      : new Map<string, { email: string; name: string }>();

    for (const { cert, userId, due } of toNotify) {
      const course = courseName.get(cert.course_id) ?? "tu curso";
      const daysLeft = daysUntil(cert.expires_at, deps.now) ?? due;

      // Aviso in-app (outbox `notifications`). Insert directo, no `notifyInApp`:
      // ese helper importa `server-only` y este módulo corre en el worker.
      // `created_at` con el `now` del tick (determinismo, igual que reminders).
      await db.from("notifications").insert({
        tenant_id: tenantId,
        user_id: userId,
        kind: "certificate.expiring",
        payload: { certificateId: cert.id, courseId: cert.course_id, expiresAt: cert.expires_at, daysLeft, offsetDays: due },
        created_at: nowIso,
      }).then(() => undefined, () => undefined);
      notified++;

      // Correo best-effort al destinatario REAL (única salida con PII), honrando
      // el opt-out del canal email (Ley 21.719: el alumno decide).
      const r = recipients.get(userId);
      if (r?.email && deps.emailSender.configured && !optedOut.has(userId)) {
        const email = renderCertificateExpiringEmail({
          brand,
          recipientName: r.name,
          courseName: course,
          daysLeft,
          expiresOn: formatExpiryDate(cert.expires_at),
          certificatesUrl,
        });
        const sent = await deps.emailSender.send({ to: r.email, subject: email.subject, html: email.html, text: email.text });
        if (sent.ok) emailsSent++;
      }
    }

    // n8n: UN evento AGREGADO por (tenant, curso, offset) — jamás uno por alumno
    // (eso sería una lista de destinatarios, o sea PII latente). RNF-10.
    const grouped = new Map<string, { courseId: string; offsetDays: number; count: number }>();
    for (const { cert, due } of toNotify) {
      const key = `${cert.course_id}|${due}`;
      const cur = grouped.get(key);
      if (cur) cur.count++;
      else grouped.set(key, { courseId: cert.course_id, offsetDays: due, count: 1 });
    }
    for (const g of grouped.values()) {
      const res = await deps.n8n.emit(
        buildExpiryN8nEvent(deps.secret, {
          tenantId,
          courseId: g.courseId,
          offsetDays: g.offsetDays,
          count: g.count,
          at: nowIso,
        }),
      );
      if (res.ok) n8nEvents++;
    }
  }

  return { tenants: tenantsProcessed, certificates, notified, emailsSent, n8nEvents };
}

/** Marca del tenant para el correo (equivale a `notify.loadBrand`, sin server-only). */
async function loadBrand(db: SupabaseClient, tenantId: string): Promise<{ orgName: string; primaryColor: string }> {
  const { data } = await db.from("tenants").select("name, branding").eq("id", tenantId).maybeSingle();
  const branding = (data?.branding ?? {}) as { primaryColor?: string };
  return { orgName: (data?.name as string) ?? "Chilearning", primaryColor: branding.primaryColor ?? "#1e3a8a" };
}
