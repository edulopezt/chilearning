import "server-only";

import { writeAudit } from "@/lib/audit";
import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import {
  complianceExportUnchecked,
  compliancePanelUnchecked,
  listComplianceActionsUnchecked,
  type CompliancePanel,
  type ComplianceExport,
  type ComplianceActionSummary,
} from "@/modules/reportes/cumplimiento-service";
import type { SupervisorScope } from "@/modules/portal-empresa/domain/supervisor";

/**
 * Portal del fiscalizador GATED (task 3.11). Única puerta del supervisor a los
 * datos de cumplimiento: como el service-role SALTA RLS, aquí se re-verifica en
 * código el grant ACTIVO y el ALCANCE, y CADA consulta/descarga queda en
 * `audit_log` (RLS no escribe en SELECT). Las páginas /supervisor/* usan SOLO
 * este servicio — nunca `cumplimiento-service` directo (eso saltaría el gate).
 */

type Guard = ReturnType<typeof tenantGuard>;

interface ActiveScope {
  readonly grantId: string;
  readonly scope: SupervisorScope;
  readonly actionIds: Set<string>; // vacío cuando scope = 'tenant'
}

/** Grant ACTIVO del caller (no revocado, no expirado) + acciones en alcance. */
async function activeScope(guard: Guard, userId: string): Promise<ActiveScope | null> {
  const nowIso = new Date().toISOString();
  const { data: grant } = await guard.db
    .from("supervisor_grants")
    .select("id, scope, expires_at, revoked_at")
    .eq("tenant_id", guard.tenantId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();
  if (!grant) return null;
  if (grant.expires_at !== null && grant.expires_at <= nowIso) return null;
  let actionIds = new Set<string>();
  if (grant.scope === "actions") {
    const { data: gas } = await guard.db.from("supervisor_grant_actions").select("action_id").eq("tenant_id", guard.tenantId).eq("grant_id", grant.id);
    actionIds = new Set((gas ?? []).map((g) => g.action_id));
  }
  return { grantId: grant.id, scope: grant.scope as SupervisorScope, actionIds };
}

function inScope(scope: ActiveScope, actionId: string): boolean {
  return scope.scope === "tenant" || scope.actionIds.has(actionId);
}

/** Solo el rol supervisor pasa por este servicio (admin usa /admin directo). */
function gate(principal: Principal): boolean {
  return Boolean(principal.tenantId) && authorize(principal, principal.tenantId!, ["supervisor"]);
}

export async function listSupervisorActions(principal: Principal): Promise<ComplianceActionSummary[]> {
  if (!gate(principal)) return [];
  const guard = tenantGuard(principal.tenantId!);
  const scope = await activeScope(guard, principal.userId);
  if (!scope) return [];
  const all = await listComplianceActionsUnchecked(principal);
  const visible = scope.scope === "tenant" ? all : all.filter((a) => scope.actionIds.has(a.actionId));
  await writeAudit(guard, { actorUserId: principal.userId, action: "supervisor.actions_viewed", entity: "supervisor_grants", entityId: scope.grantId, details: { count: visible.length } });
  return visible;
}

export async function getSupervisorPanel(principal: Principal, actionId: string): Promise<CompliancePanel | null> {
  if (!gate(principal)) return null;
  const guard = tenantGuard(principal.tenantId!);
  const scope = await activeScope(guard, principal.userId);
  if (!scope || !inScope(scope, actionId)) return null;
  const panel = await compliancePanelUnchecked(principal, actionId);
  if (!panel) return null;
  await writeAudit(guard, { actorUserId: principal.userId, action: "supervisor.panel_viewed", entity: "actions", entityId: actionId, details: { grantId: scope.grantId } });
  return panel;
}

export async function getSupervisorExport(principal: Principal, actionId: string): Promise<ComplianceExport | null> {
  if (!gate(principal)) return null;
  const guard = tenantGuard(principal.tenantId!);
  const scope = await activeScope(guard, principal.userId);
  if (!scope || !inScope(scope, actionId)) return null;
  const out = await complianceExportUnchecked(principal, actionId);
  if (!out) return null;
  await writeAudit(guard, { actorUserId: principal.userId, action: "supervisor.report_downloaded", entity: "actions", entityId: actionId, details: { grantId: scope.grantId } });
  return out;
}
