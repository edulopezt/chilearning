/**
 * Política de 2FA (task 3.6, P7). Pura. Resuelve la discrepancia de alcance
 * (constitución P7 = "superadmin y admins de OTEC" PRECEDE al plan §9 que sumaba
 * "coordinador") → TOTP obligatorio SOLO para superadmin + otec_admin.
 *
 * El ENFORCEMENT (exigir AAL2 en el guard/middleware) queda gated por el env
 * `MFA_ENFORCEMENT` (off | enroll | enforce), dormido hasta que el cloud tenga
 * plan Pro (handoff). Este módulo es la fuente de verdad de "a quién le aplica".
 */

import type { RoleKey } from "@/modules/core/domain/rbac";

const MFA_REQUIRED_ROLES: readonly RoleKey[] = ["superadmin", "otec_admin"];

export function requiresMfa(roles: readonly RoleKey[]): boolean {
  return roles.some((r) => MFA_REQUIRED_ROLES.includes(r));
}

export type MfaMode = "off" | "enroll" | "enforce";

export function mfaModeFromEnv(env: { MFA_ENFORCEMENT?: string }): MfaMode {
  const v = env.MFA_ENFORCEMENT;
  return v === "enroll" || v === "enforce" ? v : "off";
}

/**
 * Decisión del gate dado el modo, el rol, el nivel de aseguramiento (aal1/aal2)
 * y si ya tiene un factor. `ok` = pasa; `enroll` = debe inscribir 2FA; `stepup`
 * = tiene factor pero falta verificar (AAL2).
 */
export function mfaGateDecision(input: {
  mode: MfaMode;
  roles: readonly RoleKey[];
  aal: "aal1" | "aal2";
  hasFactor: boolean;
}): "ok" | "enroll" | "stepup" {
  if (input.mode !== "enforce") return "ok";
  if (!requiresMfa(input.roles)) return "ok";
  if (input.aal === "aal2") return "ok";
  return input.hasFactor ? "stepup" : "enroll";
}
