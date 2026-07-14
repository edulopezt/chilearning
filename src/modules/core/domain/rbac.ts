/**
 * RBAC deny-by-default (dominio puro) — task 0.4.
 * Los claims vienen del JWT que emite el Auth Hook (tenant_id + roles).
 * Toda decisión de acceso parte de "denegado" y solo un permiso probado la abre (P7).
 */

export const ROLE_KEYS = [
  "superadmin",
  "otec_admin",
  "coordinator",
  "instructor",
  "tutor",
  "student",
  "company",
  "supervisor",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export interface Principal {
  readonly userId: string;
  /** Tenant activo del JWT; null para superadmin o multi-tenant sin selección. */
  readonly tenantId: string | null;
  readonly roles: readonly RoleKey[];
}

function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

/** Construye un Principal a partir de claims crudos, descartando lo malformado. */
export function principalFromClaims(claims: {
  sub?: unknown;
  tenant_id?: unknown;
  roles?: unknown;
}): Principal {
  const userId = typeof claims.sub === "string" ? claims.sub : "";
  const tenantId = typeof claims.tenant_id === "string" && claims.tenant_id ? claims.tenant_id : null;
  const roles = Array.isArray(claims.roles)
    ? claims.roles.filter((r): r is RoleKey => typeof r === "string" && isRoleKey(r))
    : [];
  return { userId, tenantId, roles };
}

export function isSuperadmin(p: Principal): boolean {
  return p.roles.includes("superadmin");
}

export function hasRole(p: Principal, role: RoleKey): boolean {
  return p.roles.includes(role);
}

/** True si el principal tiene AL MENOS uno de los roles pedidos. */
export function hasAnyRole(p: Principal, roles: readonly RoleKey[]): boolean {
  return roles.some((r) => p.roles.includes(r));
}

/**
 * ¿Puede el principal actuar dentro de `tenantId`?
 * Superadmin sí (transversal). El resto SOLO en su propio tenant activo, y
 * requiere tener al menos un rol (sin roles = sin acceso).
 */
export function canActInTenant(p: Principal, tenantId: string): boolean {
  if (isSuperadmin(p)) return true;
  if (p.roles.length === 0) return false;
  return p.tenantId !== null && p.tenantId === tenantId;
}

/**
 * Autoriza el acceso a un recurso del tenant `tenantId` exigiendo alguno de los
 * `allowed` roles. Deny-by-default: cualquier duda → false.
 */
export function authorize(
  p: Principal,
  tenantId: string,
  allowed: readonly RoleKey[],
): boolean {
  if (isSuperadmin(p)) return true;
  if (!canActInTenant(p, tenantId)) return false;
  return hasAnyRole(p, allowed);
}
