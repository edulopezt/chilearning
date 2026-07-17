import "server-only";

import { ensureUser } from "@/lib/admin-users";
import { writeAudit } from "@/lib/audit";
import { tenantGuard, type TenantGuard } from "@/lib/tenant-guard";
import { renderInvitationEmail } from "@/modules/comunicacion/domain/email-templates";
import { emailSenderFromEnv, type EmailSender } from "@/modules/comunicacion/email-sender";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import {
  assignEnrollmentSchema,
  createCompanySchema,
  inviteMemberSchema,
} from "@/modules/portal-empresa/domain/company";

/**
 * Administración de EMPRESAS CLIENTE (task 5.2, HU-8.1). Alta de empresas, alta
 * y baja del personal de RRHH que entra por el portal, y vinculación de una
 * inscripción a la empresa que manda al trabajador. Gestiona: otec_admin /
 * coordinator. Toda acción queda en `audit_log`.
 *
 * ⚠ Este servicio corre con service-role (SALTA RLS): cada consulta filtra por
 * `tenant_id` a mano y toda referencia cruzada (empresa↔inscripción) se verifica
 * ANTES de escribir. Es la guardia que en el portal hacen las policies.
 *
 * El portal de LECTURA es `company-portal-service.ts` (gate + auditoría por
 * consulta): aquí no se lee dato de trabajadores.
 */

const MANAGERS = ["otec_admin", "coordinator"] as const;
const PAGE = 1000;

async function fetchAll<T>(page: (offset: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await page(offset);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function managed(principal: Principal): boolean {
  return Boolean(principal.tenantId) && authorize(principal, principal.tenantId!, MANAGERS);
}

// ---------------------------------------------------------------- crear empresa

export type CreateCompanyResult =
  | { ok: true; companyId: string }
  | { ok: false; error: "forbidden" | "invalid" | "duplicate" | "failed" };

/** Alta de una empresa cliente. El RUT es único DENTRO del OTEC. */
export async function createCompany(principal: Principal, input: unknown): Promise<CreateCompanyResult> {
  if (!managed(principal)) return { ok: false, error: "forbidden" };
  const parsed = createCompanySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const guard = tenantGuard(principal.tenantId!);

  const { data, error } = await guard.db
    .from("companies")
    .insert(
      guard.withTenant({
        rut: parsed.data.rut,
        razon_social: parsed.data.razonSocial,
        created_by: principal.userId,
      }),
    )
    .select("id")
    .single();
  // 23505 = unique_violation → `companies_tenant_rut_uk`: la empresa ya existe
  // en ESTE OTEC (que exista en otro tenant no es asunto de este tenant).
  if (error || !data) return { ok: false, error: error?.code === "23505" ? "duplicate" : "failed" };

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "company.created",
    entity: "companies",
    entityId: data.id as string,
    details: { rut: parsed.data.rut },
  });
  return { ok: true, companyId: data.id as string };
}

// --------------------------------------------------------------- listar empresas

export interface CompanyMemberItem {
  readonly id: string;
  readonly email: string;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export interface CompanyListItem {
  readonly id: string;
  readonly rut: string;
  readonly razonSocial: string;
  readonly createdAt: string;
  /** Personas de RRHH con acceso VIGENTE. */
  readonly activeMembers: number;
  /** Inscripciones (trabajadores) vinculadas a la empresa. */
  readonly enrollments: number;
  readonly members: CompanyMemberItem[];
}

/** Empresas del tenant con su personal y sus conteos. Null = sin permiso. */
export async function listCompanies(principal: Principal): Promise<CompanyListItem[] | null> {
  if (!managed(principal)) return null;
  const tenantId = principal.tenantId!;
  const guard = tenantGuard(tenantId);

  const [companies, members, enrollments] = await Promise.all([
    fetchAll<{ id: string; rut: string; razon_social: string; created_at: string }>((offset) =>
      guard.db
        .from("companies")
        .select("id, rut, razon_social, created_at")
        .eq("tenant_id", tenantId)
        .order("razon_social", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
    ),
    fetchAll<{ id: string; company_id: string; email: string; revoked_at: string | null; created_at: string }>(
      (offset) =>
        guard.db
          .from("company_members")
          .select("id, company_id, email, revoked_at, created_at")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(offset, offset + PAGE - 1),
    ),
    fetchAll<{ company_id: string | null }>((offset) =>
      guard.db
        .from("enrollments")
        .select("id, company_id")
        .eq("tenant_id", tenantId)
        .not("company_id", "is", null)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
    ),
  ]);

  const enrollmentsByCompany = new Map<string, number>();
  for (const e of enrollments) {
    if (!e.company_id) continue;
    enrollmentsByCompany.set(e.company_id, (enrollmentsByCompany.get(e.company_id) ?? 0) + 1);
  }
  const membersByCompany = new Map<string, CompanyMemberItem[]>();
  for (const m of members) {
    const list = membersByCompany.get(m.company_id) ?? [];
    list.push({ id: m.id, email: m.email, revokedAt: m.revoked_at, createdAt: m.created_at });
    membersByCompany.set(m.company_id, list);
  }

  return companies.map((c) => {
    const list = membersByCompany.get(c.id) ?? [];
    return {
      id: c.id,
      rut: c.rut,
      razonSocial: c.razon_social,
      createdAt: c.created_at,
      activeMembers: list.filter((m) => m.revokedAt === null).length,
      enrollments: enrollmentsByCompany.get(c.id) ?? 0,
      members: list,
    };
  });
}

// ------------------------------------------------------------- invitar a RRHH

export type InviteCompanyMemberResult =
  | { ok: true; memberId: string; inviteLink: string | null; emailSent: boolean }
  | { ok: false; error: "forbidden" | "invalid" | "company_not_found" | "failed" };

/**
 * Agrega el rol `company` SIN pisar los roles existentes (idempotente).
 * Mismo patrón que `ensureSupervisorMembership` (supervisor-grant-service).
 */
async function ensureCompanyMembership(guard: TenantGuard, userId: string): Promise<boolean> {
  const { data: existing } = await guard.db
    .from("memberships")
    .select("roles")
    .eq("tenant_id", guard.tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!existing) {
    const { error } = await guard.db
      .from("memberships")
      .insert(guard.withTenant({ user_id: userId, roles: ["company"], status: "active" }));
    return !error;
  }
  const roles = new Set([...(existing.roles as string[]), "company"]);
  const { error } = await guard.db
    .from("memberships")
    .update({ roles: [...roles] })
    .eq("tenant_id", guard.tenantId)
    .eq("user_id", userId);
  return !error;
}

/**
 * Invita a una persona de RRHH al portal de SU empresa. Devuelve el enlace de
 * acceso COPIABLE: sin RESEND configurado el flujo no se bloquea (el admin lo
 * comparte a mano), igual que la invitación del fiscalizador.
 */
export async function inviteCompanyMember(
  principal: Principal,
  input: unknown,
  deps: { emailSender?: EmailSender } = {},
): Promise<InviteCompanyMemberResult> {
  if (!managed(principal)) return { ok: false, error: "forbidden" };
  const parsed = inviteMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { companyId, email } = parsed.data;
  const tenantId = principal.tenantId!;
  const guard = tenantGuard(tenantId);

  // La empresa debe ser de ESTE tenant (el service-role salta RLS): sin este
  // filtro, un admin podría dar acceso a la empresa de otro OTEC.
  const { data: company } = await guard.db
    .from("companies")
    .select("id, razon_social")
    .eq("tenant_id", tenantId)
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return { ok: false, error: "company_not_found" };

  const ensured = await ensureUser(guard.db, email);
  if (!ensured) return { ok: false, error: "failed" };
  if (!(await ensureCompanyMembership(guard, ensured.userId))) return { ok: false, error: "failed" };

  // Un usuario pertenece a UNA empresa activa por tenant (`company_members_active_uk`):
  // revoca la anterior antes de insertar. Mover a alguien de empresa deja rastro.
  await guard.db
    .from("company_members")
    .update({ revoked_at: new Date().toISOString(), revoked_by: principal.userId })
    .eq("tenant_id", tenantId)
    .eq("user_id", ensured.userId)
    .is("revoked_at", null);

  const { data: member, error } = await guard.db
    .from("company_members")
    .insert(
      guard.withTenant({
        company_id: companyId,
        user_id: ensured.userId,
        email,
        created_by: principal.userId,
      }),
    )
    .select("id")
    .single();
  if (error || !member) return { ok: false, error: "failed" };

  let inviteLink: string | null = null;
  const link = await guard.db.auth.admin.generateLink({ type: "recovery", email });
  if (!link.error) inviteLink = link.data.properties?.action_link ?? null;

  let emailSent = false;
  const sender = deps.emailSender ?? emailSenderFromEnv(process.env);
  if (sender.configured && inviteLink) {
    const { data: tenant } = await guard.db
      .from("tenants")
      .select("name, branding")
      .eq("id", tenantId)
      .maybeSingle();
    const branding = (tenant?.branding ?? {}) as Record<string, unknown>;
    const rendered = renderInvitationEmail({
      brand: {
        orgName: (tenant?.name as string) ?? "Tu OTEC",
        primaryColor: typeof branding.primaryColor === "string" ? branding.primaryColor : "#1e3a8a",
      },
      recipientName: email,
      acceptUrl: inviteLink,
    });
    const r = await sender.send({ to: email, subject: rendered.subject, html: rendered.html, text: rendered.text });
    emailSent = r.ok;
  }

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "company.member_invited",
    entity: "company_members",
    entityId: member.id as string,
    details: { companyId, email, userCreated: ensured.created },
  });
  return { ok: true, memberId: member.id as string, inviteLink, emailSent };
}

// -------------------------------------------------------------- revocar a RRHH

/**
 * Corta el acceso de una persona de RRHH. NO se le quita el rol `company` de la
 * membresía a propósito: sin fila vigente en `company_members`, los helpers de
 * la migración devuelven NULL y las policies deniegan — el rol solo NO ve nada
 * (deny-by-default). Quitar el rol sería cosmético y podría pisar otro acceso.
 */
export async function revokeCompanyMember(principal: Principal, memberId: string): Promise<{ ok: boolean }> {
  if (!managed(principal)) return { ok: false };
  const tenantId = principal.tenantId!;
  const guard = tenantGuard(tenantId);
  const { data: updated, error } = await guard.db
    .from("company_members")
    .update({ revoked_at: new Date().toISOString(), revoked_by: principal.userId })
    .eq("tenant_id", tenantId)
    .eq("id", memberId)
    .is("revoked_at", null)
    .select("id");
  if (error || (updated ?? []).length === 0) return { ok: false };

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "company.member_revoked",
    entity: "company_members",
    entityId: memberId,
    details: {},
  });
  return { ok: true };
}

// ------------------------------------------- vincular inscripción ↔ empresa

export type AssignEnrollmentCompanyResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "invalid" | "enrollment_not_found" | "company_not_found" | "failed" };

/**
 * Vincula una inscripción a la empresa que manda al trabajador (o la desvincula
 * con `companyId = null` = alumno particular).
 *
 * ⚠ GUARDIA CRÍTICA: con service-role NO hay RLS que valide la referencia
 * cruzada, así que se verifica que la inscripción Y la empresa sean del MISMO
 * tenant ANTES del update. Sin esto, un admin podría etiquetar una inscripción
 * suya con la empresa de otro OTEC y esa empresa vería a un trabajador ajeno
 * (el escopado del portal es `company_id`: una vinculación falsa lo abre).
 */
export async function assignEnrollmentCompany(
  principal: Principal,
  enrollmentId: string,
  companyId: string | null,
): Promise<AssignEnrollmentCompanyResult> {
  if (!managed(principal)) return { ok: false, error: "forbidden" };
  const parsed = assignEnrollmentSchema.safeParse({ enrollmentId, companyId });
  if (!parsed.success) return { ok: false, error: "invalid" };
  const tenantId = principal.tenantId!;
  const guard = tenantGuard(tenantId);

  const { data: enrollment } = await guard.db
    .from("enrollments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.enrollmentId)
    .maybeSingle();
  if (!enrollment) return { ok: false, error: "enrollment_not_found" };

  if (parsed.data.companyId !== null) {
    const { data: company } = await guard.db
      .from("companies")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", parsed.data.companyId)
      .maybeSingle();
    if (!company) return { ok: false, error: "company_not_found" };
  }

  // El `eq("tenant_id")` del update es defensa en profundidad: ya se verificó
  // arriba, pero el filtro viaja igual (nunca un update sin tenant).
  const { error } = await guard.db
    .from("enrollments")
    .update({ company_id: parsed.data.companyId })
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.enrollmentId);
  if (error) return { ok: false, error: "failed" };

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "enrollment.company_assigned",
    entity: "enrollments",
    entityId: parsed.data.enrollmentId,
    details: { companyId: parsed.data.companyId },
  });
  return { ok: true };
}
