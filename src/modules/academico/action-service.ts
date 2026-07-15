import "server-only";

import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { parseActionInput, type ActionFieldError, type ActionInput } from "@/modules/academico/domain/action";

/**
 * CRUD de acciones de capacitación SENCE (task 1.2). Escrituras vía service-role
 * bajo tenantGuard, autorizadas a otec_admin/coordinator. El ambiente por-acción
 * (I-11) y el código se fijan aquí — es lo que Edu configura antes de certificar.
 */

export interface ActionRow {
  id: string;
  course_id: string;
  codigo_accion: string;
  training_line: number;
  environment: string;
  attendance_lock: boolean;
  starts_on: string | null;
  ends_on: string | null;
}

export type ActionServiceError = "forbidden" | "no_tenant" | "not_found" | "course_not_found";
export type ActionMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: ActionServiceError }
  | { ok: false; validation: ActionFieldError[] };

const MANAGERS = ["otec_admin", "coordinator"] as const;

function canManage(p: Principal): boolean {
  return Boolean(p.tenantId) && authorize(p, p.tenantId!, MANAGERS);
}

function toRow(v: ActionInput): Record<string, unknown> {
  return {
    course_id: v.courseId,
    codigo_accion: v.codigoAccion,
    training_line: v.trainingLine,
    environment: v.environment,
    attendance_lock: v.attendanceLock,
    starts_on: v.startsOn,
    ends_on: v.endsOn,
  };
}

export async function listActions(principal: Principal): Promise<ActionRow[]> {
  if (!principal.tenantId || !canManage(principal)) return [];
  const guard = tenantGuard(principal.tenantId);
  const { data } = await guard
    .from("actions")
    .select("id, course_id, codigo_accion, training_line, environment, attendance_lock, starts_on, ends_on");
  return (data ?? []) as ActionRow[];
}

export async function createAction(
  principal: Principal,
  raw: Record<string, unknown>,
): Promise<ActionMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };

  const parsed = parseActionInput(raw);
  if (!parsed.ok) return { ok: false, validation: parsed.errors };

  const guard = tenantGuard(principal.tenantId);
  // El curso debe existir y ser del tenant (aislamiento; la FK no cruza tenants
  // porque el filtro es explícito).
  const { data: course } = await guard
    .from("courses")
    .select("id")
    .eq("id", parsed.value.courseId)
    .maybeSingle();
  if (!course) return { ok: false, error: "course_not_found" };

  const { data, error } = await guard.db
    .from("actions")
    .insert(guard.withTenant(toRow(parsed.value)))
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "not_found" };
  return { ok: true, id: data.id as string };
}

export async function updateAction(
  principal: Principal,
  actionId: string,
  raw: Record<string, unknown>,
): Promise<ActionMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };

  const parsed = parseActionInput(raw);
  if (!parsed.ok) return { ok: false, validation: parsed.errors };

  const guard = tenantGuard(principal.tenantId);
  const { data, error } = await guard.db
    .from("actions")
    .update(toRow(parsed.value))
    .eq("id", actionId)
    .eq("tenant_id", principal.tenantId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "not_found" };
  return { ok: true, id: data.id as string };
}
