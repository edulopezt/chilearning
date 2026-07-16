import "server-only";

import { tenantGuard, type TenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { emailSenderFromEnv } from "@/modules/comunicacion/email-sender";
import type { EmailBrand, RenderedEmail } from "@/modules/comunicacion/domain/email-templates";

const STAFF_ROLES = ["otec_admin", "coordinator", "instructor", "tutor"] as const;

/** ¿Cómo accede el principal al curso? staff del tenant, alumno inscrito, o nada. */
export async function courseAccess(
  guard: TenantGuard,
  tenantId: string,
  principal: Principal,
  courseId: string,
): Promise<"staff" | "student" | null> {
  if (authorize(principal, tenantId, STAFF_ROLES)) return "staff";
  const { data } = await guard.db
    .from("enrollments")
    .select("id, actions!inner(course_id)")
    .eq("tenant_id", tenantId)
    .eq("user_id", principal.userId)
    .eq("actions.course_id", courseId)
    .limit(1)
    .maybeSingle();
  return data ? "student" : null;
}

/** Helpers compartidos de comunicación (task 3.4): marca del tenant, aviso
 *  in-app (outbox `notifications`) y correo best-effort (degrada sin RESEND). */

export async function loadBrand(guard: TenantGuard, tenantId: string): Promise<EmailBrand> {
  const { data } = await guard.db.from("tenants").select("name, branding").eq("id", tenantId).maybeSingle();
  const branding = (data?.branding ?? {}) as { primaryColor?: string };
  return { orgName: (data?.name as string) ?? "Chilearning", primaryColor: branding.primaryColor ?? "#1e3a8a" };
}

export function guardFor(tenantId: string): TenantGuard {
  return tenantGuard(tenantId);
}

/** Inserta un aviso in-app (outbox). Best-effort: nunca lanza. */
export async function notifyInApp(
  guard: TenantGuard,
  userId: string,
  kind: "announcement.published" | "forum.reply" | "message.received",
  payload: Record<string, unknown>,
): Promise<void> {
  await guard.db.from("notifications").insert(guard.withTenant({ user_id: userId, kind, payload })).then(
    () => undefined,
    () => undefined,
  );
}

/** Envía un correo si hay proveedor configurado y el usuario tiene email. */
export async function bestEffortEmail(guard: TenantGuard, userId: string, email: RenderedEmail): Promise<void> {
  const sender = emailSenderFromEnv(process.env);
  if (!sender.configured) return;
  const { data } = await guard.db.auth.admin.getUserById(userId);
  const to = data?.user?.email;
  if (!to) return;
  await sender.send({ to, subject: email.subject, html: email.html, text: email.text }).catch(() => undefined);
}
