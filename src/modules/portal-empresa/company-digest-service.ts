// ⚠ SIN `import "server-only"`: lo ejecuta el proceso WORKER (job
// `company-weekly-digest-tick`), fuera de Next. Import RELATIVO (el worker
// bundlea con esbuild) — mismo criterio que `comunicacion/reminders.ts` y
// `certificados/expiry-alerts.ts`.
import type { SupabaseClient } from "@supabase/supabase-js";

import { renderCompanyDigestEmail } from "../comunicacion/domain/email-templates";
import type { EmailSender } from "../comunicacion/email-sender";
import type { AiClient } from "../tutor-ia/ai-client";
import { collectWeeklySummaryData, type CompanyWeeklySummaryData } from "./company-weekly-data";
import { buildDigestNarrativePrompt, weekStartOf, type DigestNarrativeInput } from "./domain/weekly-digest";

/**
 * Job del digest semanal de empresa (task 5.9, HU-8.2): "recibo un resumen
 * periódico por correo (...), redactado con IA en lenguaje ejecutivo (avance,
 * riesgos, hitos) sobre datos agregados". CA: "opt-out; hacia el modelo solo
 * van datos agregados/seudonimizados; el envío es automatización periférica
 * (n8n permitido)".
 *
 * DECISIÓN (n8n): igual que `reminders.ts` y `expiry-alerts.ts` (el correo va
 * SIEMPRE directo por `EmailSender`, nunca por n8n) — a diferencia de esos dos
 * ticks, este NO emite además un evento agregado a n8n. Razón: los otros dos
 * alimentan alertas operativas para el EQUIPO de la OTEC (asistencia baja,
 * vencimientos); este digest es un correo informativo DIRECTO a RRHH de la
 * empresa cliente, sin un consumidor de n8n identificado hoy. La CA dice
 * "n8n permitido", no obligatorio — se documenta la decisión en
 * `docs/n8n/WORKFLOWS.md`; agregar el evento después es un cambio aislado si
 * aparece un caso de uso real.
 *
 * IDEMPOTENCIA — LEDGER-FIRST (mismo patrón que `certificate_expiry_alerts`,
 * task 5.12): se reserva `(tenant_id, company_id, week_start)` en
 * `company_weekly_digest_log` ANTES de tocar IA/correo. Si el tick corre dos
 * veces en la misma semana, la 2ª ve el 23505 (unique) y no reintenta nada.
 * Es at-most-once a propósito: si el proceso muere entre el claim y el envío,
 * se pierde EL digest de esa semana (nunca se duplica) — mismo trade-off que
 * `expiry-alerts.ts` (duplicar es spam irreversible; perder uno se repara
 * solo la semana siguiente).
 */

export interface CompanyDigestDeps {
  readonly now: number;
  readonly emailSender: EmailSender;
  readonly aiClient: AiClient;
  /** Base URL absoluta para el enlace al portal de la empresa (el worker no tiene origin). */
  readonly appBaseUrl?: string;
}

export interface CompanyDigestSummary {
  readonly companies: number;
  readonly sent: number;
  readonly skipped: number;
}

const IN_CHUNK = 100;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM-DD` -> `DD-MM-YYYY` (es-CL), sin tocar zona horaria (ya es una fecha calendario). */
function formatEsCl(dateYmd: string): string {
  const [y, m, d] = dateYmd.split("-");
  return `${pad2(Number(d))}-${pad2(Number(m))}-${y}`;
}

type WeeklyCounts = DigestNarrativeInput;

function toCounts(data: CompanyWeeklySummaryData): WeeklyCounts {
  return {
    workers: data.workers,
    actions: data.actions,
    lessonsCompletedInPeriod: data.lessonsCompletedInPeriod,
    attendanceDaysInPeriod: data.attendanceDaysInPeriod,
    gradesPublishedInPeriod: data.gradesPublishedInPeriod,
    certificatesIssuedInPeriod: data.certificatesIssuedInPeriod,
  };
}

/** Párrafo DETERMINÍSTICO de respaldo (sin proveedor de IA, o si la llamada falla). */
export function fallbackNarrative(counts: WeeklyCounts): string {
  return (
    `Esta semana hubo ${counts.lessonsCompletedInPeriod} lección(es) completada(s) y ` +
    `${counts.attendanceDaysInPeriod} día(s) con asistencia registrada, entre los ` +
    `${counts.workers} trabajador(es) vinculado(s) a ${counts.actions} acción(es) de capacitación. ` +
    `Se publicó(aron) ${counts.gradesPublishedInPeriod} nota(s) y se emitió(eron) ` +
    `${counts.certificatesIssuedInPeriod} certificado(s) en el período.`
  );
}

async function loadBrand(db: SupabaseClient, tenantId: string): Promise<{ orgName: string; primaryColor: string }> {
  const { data } = await db.from("tenants").select("name, branding").eq("id", tenantId).maybeSingle();
  const branding = (data?.branding ?? {}) as { primaryColor?: string };
  return { orgName: (data?.name as string) ?? "Chilearning", primaryColor: branding.primaryColor ?? "#1e3a8a" };
}

/** Miembros VIGENTES de la empresa (`revoked_at is null`), menos el opt-out de email (Ley 21.719). */
async function activeRecipients(
  db: SupabaseClient,
  tenantId: string,
  companyId: string,
): Promise<{ userId: string; email: string }[]> {
  const { data: members } = await db
    .from("company_members")
    .select("user_id, email")
    .eq("tenant_id", tenantId)
    .eq("company_id", companyId)
    .is("revoked_at", null);
  const rows = (members ?? []) as { user_id: string; email: string }[];
  if (rows.length === 0) return [];

  const userIds = rows.map((m) => m.user_id);
  const optedOut = new Set<string>();
  for (let i = 0; i < userIds.length; i += IN_CHUNK) {
    const { data } = await db
      .from("communication_opt_outs")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("channel", "email")
      .in("user_id", userIds.slice(i, i + IN_CHUNK));
    for (const o of data ?? []) optedOut.add(o.user_id as string);
  }
  return rows.filter((m) => !optedOut.has(m.user_id)).map((m) => ({ userId: m.user_id, email: m.email }));
}

export async function runCompanyWeeklyDigestTick(
  db: SupabaseClient,
  deps: CompanyDigestDeps,
): Promise<CompanyDigestSummary> {
  const nowIso = new Date(deps.now).toISOString();
  const weekStart = weekStartOf(nowIso);
  const weekStartIso = `${weekStart}T00:00:00.000Z`;

  const { data: companies } = await db.from("companies").select("id, tenant_id, razon_social");
  const rows = (companies ?? []) as { id: string; tenant_id: string; razon_social: string }[];
  if (rows.length === 0) return { companies: 0, sent: 0, skipped: 0 };

  let sent = 0;
  let skipped = 0;

  for (const company of rows) {
    const tenantId = company.tenant_id;
    const companyId = company.id;

    // LEDGER-FIRST: reserva la semana ANTES de tocar IA/correo (ver cabecera).
    const { error: claimError } = await db
      .from("company_weekly_digest_log")
      .insert({ tenant_id: tenantId, company_id: companyId, week_start: weekStart, sent_at: nowIso });
    if (claimError) {
      skipped++; // 23505 = ya se envió esta semana; cualquier otro error, igual no se reintenta ahora.
      continue;
    }

    const data = await collectWeeklySummaryData(db, tenantId, companyId, weekStartIso);
    // Empresa sin trabajadores vinculados: no hay nada que reportar (distinto
    // de "semana tranquila" -- ahí SÍ se envía, ver más abajo).
    if (!data || data.workers === 0) {
      skipped++;
      continue;
    }

    const recipients = await activeRecipients(db, tenantId, companyId);
    if (recipients.length === 0) {
      skipped++; // sin destinatarios vigentes (revocados/opt-out): el ledger igual quedó reservado esta semana.
      continue;
    }

    const counts = toCounts(data);
    let narrative = fallbackNarrative(counts);
    if (deps.aiClient.configured) {
      const { system, messages } = buildDigestNarrativePrompt(counts);
      const result = await deps.aiClient.complete([{ role: "system", content: system }, ...messages]);
      if (result.ok && result.text.trim().length > 0) narrative = result.text.trim();
      // Si falla o vuelve vacío: se queda con el fallback determinístico (la CA
      // no exige IA obligatoria, solo permite mejorarlo cuando está disponible).
    }

    const brand = await loadBrand(db, tenantId);
    const base = (deps.appBaseUrl ?? "").replace(/\/$/, "");
    const email = renderCompanyDigestEmail({
      brand,
      razonSocial: company.razon_social,
      weekStart: formatEsCl(weekStart),
      narrative,
      ...counts,
      portalUrl: `${base}/empresa`,
    });

    let anySent = false;
    if (deps.emailSender.configured) {
      for (const r of recipients) {
        const result = await deps.emailSender.send({ to: r.email, subject: email.subject, html: email.html, text: email.text });
        if (result.ok) anySent = true;
      }
    }
    if (anySent) sent++;
    else skipped++;
  }

  return { companies: rows.length, sent, skipped };
}
