import "server-only";

import { writeAudit } from "@/lib/audit";
import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { emailSenderFromEnv, type EmailSender } from "@/modules/comunicacion/email-sender";
import { renderInvitationEmail } from "@/modules/comunicacion/domain/email-templates";
import {
  createGrantSchema,
  expiresOnToTimestamp,
  grantStatus,
  normalizeActionIds,
  type GrantStatus,
  type SupervisorScope,
} from "@/modules/portal-empresa/domain/supervisor";

/**
 * Alta/baja de fiscalizadores (task 3.11). El acceso lo controla el grant
 * (vigencia + alcance); las policies RLS y el portal-service lo hacen cumplir.
 * Gestiona: otec_admin / coordinator. Toda alta y baja queda en `audit_log`.
 */

const MANAGERS = ["otec_admin", "coordinator"] as const;
type Guard = ReturnType<typeof tenantGuard>;

export interface GrantListItem {
  readonly id: string;
  readonly email: string;
  readonly scope: SupervisorScope;
  readonly status: GrantStatus;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly actionIds: string[];
  readonly createdAt: string;
}

export type CreateGrantResult =
  | { ok: true; grantId: string; inviteLink: string | null; emailSent: boolean }
  | { ok: false; error: "forbidden" | "invalid" | "scope_out_of_tenant" | "failed" };

function throwawayPassword(): string {
  // El supervisor entra por el enlace de invitación; esta clave nunca se usa.
  // Un solo UUID: bcrypt (GoTrue) tope en 72 bytes; dos UUIDs (76) lo revientan.
  return `Sv-${crypto.randomUUID()}`;
}

/** Busca el user_id por email recorriendo el admin API (idempotencia). */
async function findUserByEmail(db: Guard["db"], email: string): Promise<string | null> {
  const key = email.toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const users = data?.users ?? [];
    for (const u of users) if (u.email?.toLowerCase() === key) return u.id;
    if (users.length < 200) break;
  }
  return null;
}

async function ensureUser(db: Guard["db"], email: string): Promise<string | null> {
  // Intento crear primero: en el happy path (email nuevo) evita escanear TODOS los
  // usuarios con listUsers. Si el correo ya existe, createUser falla (email ya
  // registrado) y recién ahí lo busco por email.
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true, password: throwawayPassword() });
  if (data?.user) return data.user.id;
  if (!error) return null;
  return findUserByEmail(db, email);
}

async function ensureSupervisorMembership(guard: Guard, userId: string): Promise<boolean> {
  // Añade el rol supervisor SIN pisar roles existentes. Si ya existe la membresía
  // con otros roles, se le agrega 'supervisor' de forma idempotente.
  const { data: existing } = await guard.db.from("memberships").select("roles").eq("tenant_id", guard.tenantId).eq("user_id", userId).maybeSingle();
  if (!existing) {
    const { error } = await guard.db.from("memberships").insert(guard.withTenant({ user_id: userId, roles: ["supervisor"], status: "active" }));
    return !error;
  }
  const roles = new Set([...(existing.roles as string[]), "supervisor"]);
  const { error } = await guard.db.from("memberships").update({ roles: [...roles] }).eq("tenant_id", guard.tenantId).eq("user_id", userId);
  return !error;
}

export async function createGrant(
  principal: Principal,
  input: unknown,
  deps: { emailSender?: EmailSender } = {},
): Promise<CreateGrantResult> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, MANAGERS)) return { ok: false, error: "forbidden" };
  const parsed = createGrantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { email, scope, actionIds, expiresOn } = parsed.data;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  // Las acciones del alcance deben ser del tenant (el service-role salta RLS).
  const ids = normalizeActionIds(actionIds);
  if (scope === "actions") {
    const { data: owned } = await guard.db.from("actions").select("id").eq("tenant_id", tenantId).in("id", ids);
    if ((owned ?? []).length !== ids.length) return { ok: false, error: "scope_out_of_tenant" };
  }

  const userId = await ensureUser(guard.db, email);
  if (!userId) return { ok: false, error: "failed" };
  if (!(await ensureSupervisorMembership(guard, userId))) return { ok: false, error: "failed" };

  // Un solo grant vigente por (tenant, usuario): revoca el anterior antes de emitir.
  await guard.db
    .from("supervisor_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: principal.userId })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .is("revoked_at", null);

  const { data: grant, error } = await guard.db
    .from("supervisor_grants")
    .insert(guard.withTenant({ user_id: userId, email, scope, expires_at: expiresOnToTimestamp(expiresOn), created_by: principal.userId }))
    .select("id")
    .single();
  if (error || !grant) return { ok: false, error: "failed" };

  if (scope === "actions" && ids.length > 0) {
    const rows = ids.map((action_id) => guard.withTenant({ grant_id: grant.id, action_id }));
    const { error: gaErr } = await guard.db.from("supervisor_grant_actions").insert(rows);
    if (gaErr) return { ok: false, error: "failed" };
  }

  // Enlace de invitación (funciona sin RESEND: el admin lo copia).
  let inviteLink: string | null = null;
  const link = await guard.db.auth.admin.generateLink({ type: "recovery", email });
  if (!link.error) inviteLink = link.data.properties?.action_link ?? null;

  let emailSent = false;
  const sender = deps.emailSender ?? emailSenderFromEnv(process.env);
  if (sender.configured && inviteLink) {
    const { data: tenant } = await guard.db.from("tenants").select("name, branding").eq("id", tenantId).maybeSingle();
    const branding = (tenant?.branding ?? {}) as Record<string, unknown>;
    const rendered = renderInvitationEmail({
      brand: { orgName: (tenant?.name as string) ?? "Tu OTEC", primaryColor: typeof branding.primaryColor === "string" ? branding.primaryColor : "#1e3a8a" },
      recipientName: email,
      acceptUrl: inviteLink,
    });
    const r = await sender.send({ to: email, subject: rendered.subject, html: rendered.html, text: rendered.text });
    emailSent = r.ok;
  }

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "supervisor.grant_created",
    entity: "supervisor_grants",
    entityId: grant.id,
    details: { email, scope, actions: ids.length, expiresAt: expiresOnToTimestamp(expiresOn) },
  });
  return { ok: true, grantId: grant.id, inviteLink, emailSent };
}

export async function listGrants(principal: Principal): Promise<GrantListItem[] | null> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, MANAGERS)) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data: grants } = await guard.db
    .from("supervisor_grants")
    .select("id, email, scope, expires_at, revoked_at, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  const rows = grants ?? [];
  if (rows.length === 0) return [];
  const { data: gas } = await guard.db.from("supervisor_grant_actions").select("grant_id, action_id").eq("tenant_id", tenantId);
  const byGrant = new Map<string, string[]>();
  for (const g of gas ?? []) byGrant.set(g.grant_id, [...(byGrant.get(g.grant_id) ?? []), g.action_id]);
  const now = new Date().toISOString();
  return rows.map((g) => ({
    id: g.id,
    email: g.email,
    scope: g.scope as SupervisorScope,
    status: grantStatus({ expiresAt: g.expires_at, revokedAt: g.revoked_at }, now),
    expiresAt: g.expires_at,
    revokedAt: g.revoked_at,
    actionIds: byGrant.get(g.id) ?? [],
    createdAt: g.created_at,
  }));
}

export async function revokeGrant(principal: Principal, grantId: string): Promise<{ ok: boolean }> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, MANAGERS)) return { ok: false };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data: updated, error } = await guard.db
    .from("supervisor_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: principal.userId })
    .eq("tenant_id", tenantId)
    .eq("id", grantId)
    .is("revoked_at", null)
    .select("id, user_id");
  if (error || (updated ?? []).length === 0) return { ok: false };
  await writeAudit(guard, { actorUserId: principal.userId, action: "supervisor.grant_revoked", entity: "supervisor_grants", entityId: grantId, details: {} });
  return { ok: true };
}
