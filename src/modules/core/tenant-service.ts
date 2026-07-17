import "server-only";

import { ensureUser } from "@/lib/admin-users";
import { writeAudit } from "@/lib/audit";
import { tenantGuard, untenantedServiceClient, type TenantGuard } from "@/lib/tenant-guard";
import { renderInvitationEmail } from "@/modules/comunicacion/domain/email-templates";
import { emailSenderFromEnv, type EmailSender } from "@/modules/comunicacion/email-sender";
import { FEATURE_KEYS, flagsUpdateSchema, isFeatureEnabled, type FeatureKey } from "@/modules/core/domain/features";
import { isSuperadmin, type Principal } from "@/modules/core/domain/rbac";
import { createTenantSchema, DEFAULT_TENANT_FLAGS } from "@/modules/core/domain/tenant";

/**
 * Ciclo de vida de tenants (task 5.3, HU-1.1/1.4/1.3). SOLO superadmin: toda
 * función gatea por el claim de plataforma (deny-by-default). El subdominio
 * queda operativo al instante (wildcard DNS: crear tenant = insertar la fila) y
 * toda acción deja traza en audit_log (P8).
 */

const UNIQUE_VIOLATION = "23505";

export interface TenantListItem {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly plan: string;
  readonly status: "active" | "suspended";
  readonly flags: Readonly<Record<FeatureKey, boolean>>;
  readonly createdAt: string;
}

export type CreateTenantResult =
  | { ok: true; tenantId: string; slug: string; inviteLink: string | null; emailSent: boolean }
  | { ok: false; error: "forbidden" | "invalid" | "slug_taken" | "failed" };

export type TenantMutationResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "invalid" | "failed" };

/** Normaliza el jsonb crudo de flags a los booleanos de las claves conocidas. */
function normalizeFlags(raw: unknown): Record<FeatureKey, boolean> {
  return Object.fromEntries(
    FEATURE_KEYS.map((key) => [key, isFeatureEnabled(raw, key)]),
  ) as Record<FeatureKey, boolean>;
}

/** tenantGuard() lanza si el id no es un UUID; input de FormData => deny limpio. */
function guardFor(tenantId: string): TenantGuard | null {
  try {
    return tenantGuard(tenantId);
  } catch {
    return null;
  }
}

/**
 * HU-1.1: crea la OTEC con plan, subdominio y admin inicial. El admin recibe
 * la invitación por correo; sin RESEND_API_KEY degrada al enlace copiable.
 */
export async function createTenant(
  principal: Principal,
  input: unknown,
  deps: { emailSender?: EmailSender } = {},
): Promise<CreateTenantResult> {
  if (!isSuperadmin(principal)) return { ok: false, error: "forbidden" };
  const parsed = createTenantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { name, slug, plan, adminEmail, rut } = parsed.data;

  const tenantId = crypto.randomUUID();
  const guard = tenantGuard(tenantId);

  // El tenant nace con configuración por defecto SEGURA: todo flag apagado.
  const { error: insertErr } = await guard.db
    .from("tenants")
    .insert({ id: tenantId, slug, name, rut, plan, flags: DEFAULT_TENANT_FLAGS });
  if (insertErr) {
    return { ok: false, error: insertErr.code === UNIQUE_VIOLATION ? "slug_taken" : "failed" };
  }

  // Admin inicial: usuario de Auth + membership otec_admin. No hay transacción
  // que cruce Auth y Postgres: si el alta falla, ROLLBACK compensatorio (se
  // borra el tenant recién creado; aún no tiene hijos ni auditoría).
  const userId = await ensureUser(guard.db, adminEmail);
  if (!userId) {
    await guard.db.from("tenants").delete().eq("id", tenantId);
    return { ok: false, error: "failed" };
  }

  const { error: memberErr } = await guard.db
    .from("memberships")
    .insert(guard.withTenant({ user_id: userId, roles: ["otec_admin"], status: "active" }));
  if (memberErr) {
    // El usuario NO se borra: puede preexistir (correo ya registrado).
    await guard.db.from("tenants").delete().eq("id", tenantId);
    return { ok: false, error: "failed" };
  }

  // Enlace de invitación (funciona sin RESEND: el superadmin lo copia).
  let inviteLink: string | null = null;
  const link = await guard.db.auth.admin.generateLink({ type: "recovery", email: adminEmail });
  if (!link.error) inviteLink = link.data.properties?.action_link ?? null;

  let emailSent = false;
  const sender = deps.emailSender ?? emailSenderFromEnv(process.env);
  if (sender.configured && inviteLink) {
    const rendered = renderInvitationEmail({
      brand: { orgName: name, primaryColor: "#1e3a8a" },
      recipientName: adminEmail,
      acceptUrl: inviteLink,
    });
    const r = await sender.send({
      to: adminEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    emailSent = r.ok;
  }

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "tenant.created",
    entity: "tenants",
    entityId: tenantId,
    details: { slug, plan, adminEmail },
  });

  return { ok: true, tenantId, slug, inviteLink, emailSent };
}

async function setStatus(
  principal: Principal,
  tenantId: string,
  status: "active" | "suspended",
  auditAction: "tenant.suspended" | "tenant.reactivated",
): Promise<TenantMutationResult> {
  if (!isSuperadmin(principal)) return { ok: false, error: "forbidden" };
  const guard = guardFor(tenantId);
  if (!guard) return { ok: false, error: "failed" };

  const { data, error } = await guard.db
    .from("tenants")
    .update({ status })
    .eq("id", tenantId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "failed" };

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: auditAction,
    entity: "tenants",
    entityId: tenantId,
    details: {},
  });
  return { ok: true };
}

/** HU-1.4: bloquea el acceso SIN borrar datos (aviso en middleware + hook). */
export async function suspendTenant(principal: Principal, tenantId: string): Promise<TenantMutationResult> {
  return setStatus(principal, tenantId, "suspended", "tenant.suspended");
}

/** HU-1.4: reactivación en 1 clic. */
export async function reactivateTenant(principal: Principal, tenantId: string): Promise<TenantMutationResult> {
  return setStatus(principal, tenantId, "active", "tenant.reactivated");
}

/** HU-1.3: enciende/apaga features por tenant (merge sobre los flags actuales). */
export async function setTenantFlags(
  principal: Principal,
  tenantId: string,
  input: unknown,
): Promise<TenantMutationResult> {
  if (!isSuperadmin(principal)) return { ok: false, error: "forbidden" };
  const parsed = flagsUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const guard = guardFor(tenantId);
  if (!guard) return { ok: false, error: "failed" };

  const { data: row } = await guard.db.from("tenants").select("flags").eq("id", tenantId).maybeSingle();
  if (!row) return { ok: false, error: "failed" };

  const current =
    typeof row.flags === "object" && row.flags !== null && !Array.isArray(row.flags)
      ? (row.flags as Record<string, unknown>)
      : {};
  const merged = { ...current, ...parsed.data };

  const { error } = await guard.db.from("tenants").update({ flags: merged }).eq("id", tenantId);
  if (error) return { ok: false, error: "failed" };

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "tenant.flags_updated",
    entity: "tenants",
    entityId: tenantId,
    details: { changed: parsed.data },
  });
  return { ok: true };
}

/** Lista TODOS los tenants de la plataforma (solo superadmin). */
export async function listTenants(principal: Principal): Promise<TenantListItem[] | null> {
  if (!isSuperadmin(principal)) return null;
  // Caso PLATAFORMA, la excepción legítima a tenantGuard(): el superadmin lista
  // TODOS los tenants y no existe un tenant al que atar el guard. El cliente
  // sin tenant se usa SOLO para este select transversal de la tabla tenants.
  const db = untenantedServiceClient();
  const { data } = await db
    .from("tenants")
    .select("id, slug, name, plan, status, flags, created_at")
    .order("created_at", { ascending: true });
  return (data ?? []).map((t) => ({
    id: t.id as string,
    slug: t.slug as string,
    name: t.name as string,
    plan: t.plan as string,
    status: t.status as "active" | "suspended",
    flags: normalizeFlags(t.flags),
    createdAt: t.created_at as string,
  }));
}
