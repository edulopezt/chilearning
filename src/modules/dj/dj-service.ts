import "server-only";

import { writeAudit } from "@/lib/audit";
import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { santiagoDate } from "@/modules/reportes/domain/cumplimiento";
import { applyTransition, isOverdue, settlementDeadline, type DjState } from "@/modules/dj/domain/state-machine";
import { djRosterRow, DJ_ROSTER_HEADERS, type DjRosterEntry } from "@/modules/dj/domain/roster";

/**
 * Checklist de DJ por acción (task 3.3, HU-5.6). La plataforma guía y registra;
 * la DJ se emite en la GCA de SENCE (P3). Estados con transiciones validadas,
 * ventana de liquidación de 60 días y nómina exportable para la GCA.
 */

const MANAGERS = ["otec_admin", "coordinator"] as const;
const VIEWERS = ["otec_admin", "coordinator", "instructor"] as const;
const PAGE = 1000;

function settlementDays(): number {
  const raw = Number(process.env.DJ_SETTLEMENT_DAYS);
  return Number.isInteger(raw) && raw > 0 ? raw : 60;
}

async function fetchAll<T>(page: (o: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let o = 0; ; o += PAGE) {
    const { data } = await page(o);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Siembra idempotente: una fila por inscripción NO exenta de la acción. */
export async function ensureChecklist(principal: Principal, actionId: string): Promise<{ ok: boolean; created?: number }> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, MANAGERS)) return { ok: false };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data: action } = await guard.db.from("actions").select("id, ends_on").eq("tenant_id", tenantId).eq("id", actionId).maybeSingle();
  if (!action) return { ok: false };
  const deadline = settlementDeadline((action.ends_on as string | null) ?? null, settlementDays());

  const enrollments = await fetchAll<{ id: string }>((o) =>
    guard.db.from("enrollments").select("id").eq("tenant_id", tenantId).eq("action_id", actionId).eq("exento", false).order("id").range(o, o + PAGE - 1),
  );
  if (enrollments.length === 0) return { ok: true, created: 0 };

  const rows = enrollments.map((e) => guard.withTenant({ action_id: actionId, enrollment_id: e.id, settlement_deadline: deadline }));
  // on_conflict do nothing por el unique(action_id, enrollment_id): idempotente.
  const { error } = await guard.db.from("dj_checklist").upsert(rows, { onConflict: "action_id,enrollment_id", ignoreDuplicates: true });
  if (error) return { ok: false };
  await writeAudit(guard, { actorUserId: principal.userId, action: "dj.checklist_seeded", entity: "actions", entityId: actionId, details: { count: enrollments.length } });
  return { ok: true, created: enrollments.length };
}

export type SetStateResult = { ok: true } | { ok: false; error: "forbidden" | "not_found" | "invalid_transition" };

export async function setDjState(principal: Principal, checklistId: string, next: DjState, notes?: string): Promise<SetStateResult> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, MANAGERS)) return { ok: false, error: "forbidden" };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data: cur } = await guard.db.from("dj_checklist").select("id, state").eq("tenant_id", tenantId).eq("id", checklistId).maybeSingle();
  if (!cur) return { ok: false, error: "not_found" };
  const t = applyTransition(cur.state as DjState, next);
  if (!t.changed) return { ok: false, error: "invalid_transition" };
  const { error } = await guard.db.from("dj_checklist").update({ state: next, notes: notes ?? null, updated_by: principal.userId }).eq("tenant_id", tenantId).eq("id", checklistId);
  if (error) return { ok: false, error: "not_found" };
  await writeAudit(guard, { actorUserId: principal.userId, action: "dj.state_changed", entity: "dj_checklist", entityId: checklistId, details: { from: cur.state, to: next, notes: notes ?? "" } });
  return { ok: true };
}

export interface DjChecklistRow {
  readonly id: string;
  readonly enrollmentId: string;
  readonly nombres: string;
  readonly apellidos: string;
  readonly run: string;
  readonly state: DjState;
  readonly settlementDeadline: string | null;
  readonly overdue: boolean;
  readonly updatedAt: string;
}

async function loadRows(principal: Principal, actionId: string): Promise<DjChecklistRow[] | null> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, VIEWERS)) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const rows = await fetchAll<{ id: string; enrollment_id: string; state: DjState; settlement_deadline: string | null; updated_at: string }>((o) =>
    guard.db.from("dj_checklist").select("id, enrollment_id, state, settlement_deadline, updated_at").eq("tenant_id", tenantId).eq("action_id", actionId).order("id").range(o, o + PAGE - 1),
  );
  if (rows.length === 0) return [];
  const enr = await fetchAll<{ id: string; first_names: string | null; last_names: string | null; run: string | null }>((o) =>
    guard.db.from("enrollments").select("id, first_names, last_names, run").eq("tenant_id", tenantId).eq("action_id", actionId).order("id").range(o, o + PAGE - 1),
  );
  const nameById = new Map(enr.map((e) => [e.id, e]));
  const today = santiagoDate(Date.now());
  return rows.map((r) => {
    const e = nameById.get(r.enrollment_id);
    return {
      id: r.id,
      enrollmentId: r.enrollment_id,
      nombres: e?.first_names ?? "",
      apellidos: e?.last_names ?? "",
      run: e?.run ?? "",
      state: r.state,
      settlementDeadline: r.settlement_deadline,
      overdue: r.state !== "anulada" && r.state !== "emitida" && r.state !== "aprobado_reemision" && isOverdue(r.settlement_deadline, today),
      updatedAt: r.updated_at,
    };
  }).sort((a, b) => `${a.apellidos} ${a.nombres}`.localeCompare(`${b.apellidos} ${b.nombres}`));
}

export async function getChecklist(principal: Principal, actionId: string): Promise<DjChecklistRow[] | null> {
  return loadRows(principal, actionId);
}

export async function exportRoster(principal: Principal, actionId: string): Promise<{ filename: string; headers: readonly string[]; rows: string[][] } | null> {
  const rows = await loadRows(principal, actionId);
  if (rows === null) return null;
  const entries: DjRosterEntry[] = rows.map((r) => ({ nombres: r.nombres, apellidos: r.apellidos, run: r.run, state: r.state, settlementDeadline: r.settlementDeadline, overdue: r.overdue, updatedAt: new Date(r.updatedAt).toLocaleDateString("es-CL") }));
  return { filename: `dj-${actionId.slice(0, 8)}`, headers: DJ_ROSTER_HEADERS, rows: entries.map(djRosterRow) };
}
