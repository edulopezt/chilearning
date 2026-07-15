import "server-only";

import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { renderWelcomeEmail } from "@/modules/comunicacion/domain/email-templates";
import { emailSenderFromEnv, type EmailSender } from "@/modules/comunicacion/email-sender";

/**
 * Envío de la guía Clave Única a los inscritos de una acción (task 2.7,
 * HU-5.8). Vive en `comunicacion` (plantillas + sender) y NO en `sence`:
 * el módulo SENCE es autocontenido (I-16) y solo LEE la marca desde
 * `audit_log` (`sence.guide_sent` / `sence.guide_marked_sent`).
 *
 * Best-effort por alumno; el resumen (sent/failed/skipped) se audita con
 * conteos, jamás con direcciones (Ley 21.719). Sin proveedor configurado
 * devuelve `not_configured` y la UI ofrece la marca manual.
 */

const MANAGERS = ["otec_admin", "coordinator"] as const;

export type GuideError =
  | "forbidden"
  | "no_tenant"
  | "not_found"
  | "not_configured"
  | "audit_failed";

export interface GuideSendSummary {
  sent: number;
  failed: number;
  /** Inscritos no exentos sin correo localizable. */
  skipped: number;
}

export interface GuideDeps {
  emailSender?: EmailSender;
  /** URL absoluta a /mi-curso en el host del tenant (la calcula la capa app). */
  courseUrl?: string;
}

export async function sendClaveUnicaGuide(
  principal: Principal,
  actionId: string,
  deps: GuideDeps = {},
): Promise<
  | { ok: true; summary: GuideSendSummary; audited: boolean }
  | { ok: false; error: GuideError }
> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!authorize(principal, principal.tenantId, MANAGERS)) {
    return { ok: false, error: "forbidden" };
  }
  const sender = deps.emailSender ?? emailSenderFromEnv(process.env);
  if (!sender.configured || !deps.courseUrl) {
    return { ok: false, error: "not_configured" };
  }

  const guard = tenantGuard(principal.tenantId);
  const { data: action } = await guard
    .from("actions")
    .select("id, course_id")
    .eq("id", actionId)
    .maybeSingle();
  if (!action) return { ok: false, error: "not_found" };

  const [{ data: course }, { data: tenant }, { data: enrollments }] = await Promise.all([
    guard.db
      .from("courses")
      .select("name")
      .eq("id", action.course_id as string)
      .eq("tenant_id", principal.tenantId)
      .maybeSingle(),
    guard.db.from("tenants").select("name, branding").eq("id", principal.tenantId).maybeSingle(),
    guard.db
      .from("enrollments")
      .select("id, user_id, exento")
      .eq("tenant_id", principal.tenantId)
      .eq("action_id", actionId)
      .eq("exento", false), // los exentos no registran SENCE (I-14): sin guía
  ]);

  const branding = (tenant?.branding ?? {}) as Record<string, unknown>;
  const brand = {
    orgName: (tenant?.name as string) ?? "Tu OTEC",
    primaryColor:
      typeof branding.primaryColor === "string" ? branding.primaryColor : "#1e3a8a",
  };
  const courseName = (course?.name as string) ?? "tu curso";

  // email por user_id vía Admin API paginada (mismo patrón del import 1.3).
  const userIds = new Set(
    ((enrollments ?? []) as { user_id: string }[]).map((e) => e.user_id),
  );
  const emailById = new Map<string, { email: string; name: string }>();
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await guard.db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    for (const u of data?.users ?? []) {
      if (u.email && userIds.has(u.id)) {
        emailById.set(u.id, {
          email: u.email,
          name: (u.user_metadata?.full_name as string | undefined) ?? "",
        });
      }
    }
    if ((data?.users ?? []).length < 200) break;
    if (page === 50) {
      // Revisión R-4 del PR #33: sobre 10.000 usuarios globales, los que caen
      // después de la página 50 quedarían como "sin correo" en silencio.
      // Follow-up anotado: resolver por getUserById o tabla profiles con RLS.
      console.warn("[guia] índice de usuarios truncado en 10.000; destinatarios pueden faltar", {
        actionId,
      });
    }
  }

  const summary: GuideSendSummary = { sent: 0, failed: 0, skipped: 0 };
  for (const userId of userIds) {
    const recipient = emailById.get(userId);
    if (!recipient) {
      summary.skipped += 1;
      continue;
    }
    const rendered = renderWelcomeEmail({
      brand,
      recipientName: recipient.name || "estudiante",
      courseName,
      courseUrl: deps.courseUrl,
    });
    const result = await sender.send({
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    if (result.ok) summary.sent += 1;
    else summary.failed += 1;
  }

  // Revisión R-3 del PR #33: los correos ya salieron (irreversible), pero un
  // envío masivo SIN rastro auditable viola P8 — y además el checklist (que
  // LEE la marca) invitaría a un segundo envío duplicado. Se reporta al
  // llamador para que la UI lo diga en vez de tragar el fallo.
  const audited = await writeGuideAudit(guard, principal, actionId, "sence.guide_sent", summary);
  return { ok: true, summary, audited };
}

/** Marca manual (fallback sin proveedor): deja constancia auditada. */
export async function markGuideSent(
  principal: Principal,
  actionId: string,
): Promise<{ ok: true } | { ok: false; error: GuideError }> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!authorize(principal, principal.tenantId, MANAGERS)) {
    return { ok: false, error: "forbidden" };
  }
  const guard = tenantGuard(principal.tenantId);
  const { data: action } = await guard
    .from("actions")
    .select("id")
    .eq("id", actionId)
    .maybeSingle();
  if (!action) return { ok: false, error: "not_found" };

  // La marca ES el registro: si la auditoría falla, la operación falló (R-3).
  const audited = await writeGuideAudit(
    guard,
    principal,
    actionId,
    "sence.guide_marked_sent",
    null,
  );
  if (!audited) return { ok: false, error: "audit_failed" };
  return { ok: true };
}

async function writeGuideAudit(
  guard: ReturnType<typeof tenantGuard>,
  principal: Principal,
  actionId: string,
  auditAction: "sence.guide_sent" | "sence.guide_marked_sent",
  summary: GuideSendSummary | null,
): Promise<boolean> {
  const { error } = await guard.db.from("audit_log").insert(
    guard.withTenant({
      actor_user_id: principal.userId,
      action: auditAction,
      entity: "actions",
      entity_id: actionId,
      details: summary ? { ...summary } : {},
    }),
  );
  if (error) {
    console.error("[guia] auditoría del envío de guía falló", { message: error.message });
    return false;
  }
  return true;
}
