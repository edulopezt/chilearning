import "server-only";

import { writeAudit } from "@/lib/audit";
import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { parseActionInput, type ActionFieldError, type ActionInput } from "@/modules/academico/domain/action";
import { validateActivation } from "@/modules/academico/domain/action-activation";

/**
 * CRUD de acciones de capacitación SENCE (task 1.2) + estado draft/active y
 * re-ejecución (task 2.8). Escrituras vía service-role bajo tenantGuard,
 * autorizadas a otec_admin/coordinator. Una acción NACE en borrador (o activa si
 * ya trae fechas); solo pasa a activa con fechas y, si es re-ejecución, con un
 * código NUEVO (distinto al de origen).
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
  status: "draft" | "active";
  cloned_from: string | null;
}

export type ActionServiceError =
  | "forbidden"
  | "no_tenant"
  | "not_found"
  | "course_not_found"
  | "missing_dates"
  | "code_unchanged";
export type ActionMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: ActionServiceError }
  | { ok: false; validation: ActionFieldError[] };

const MANAGERS = ["otec_admin", "coordinator"] as const;
const ROW_COLUMNS =
  "id, course_id, codigo_accion, training_line, environment, attendance_lock, starts_on, ends_on, status, cloned_from";

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
  const { data } = await guard.from("actions").select(ROW_COLUMNS);
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

  // Con ambas fechas nace activa; si no, borrador (se activará luego).
  const status = parsed.value.startsOn && parsed.value.endsOn ? "active" : "draft";
  const { data, error } = await guard.db
    .from("actions")
    .insert(guard.withTenant({ ...toRow(parsed.value), status }))
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

/**
 * Re-ejecuta una acción: copia su configuración a una acción NUEVA en borrador,
 * sin fechas y sin inscripciones (`cloned_from` = origen). El usuario le pondrá
 * un código nuevo y fechas antes de activarla (task 2.8, HU-3.6).
 */
export async function reexecuteAction(
  principal: Principal,
  actionId: string,
): Promise<ActionMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const guard = tenantGuard(principal.tenantId);

  const { data: src } = await guard.db
    .from("actions")
    .select("id, course_id, codigo_accion, training_line, environment")
    .eq("id", actionId)
    .eq("tenant_id", principal.tenantId)
    .maybeSingle();
  if (!src) return { ok: false, error: "not_found" };

  const { data, error } = await guard.db
    .from("actions")
    .insert(
      guard.withTenant({
        course_id: src.course_id,
        codigo_accion: src.codigo_accion, // el usuario DEBE cambiarlo antes de activar
        training_line: src.training_line,
        environment: src.environment,
        attendance_lock: true,
        starts_on: null,
        ends_on: null,
        status: "draft",
        cloned_from: actionId,
      }),
    )
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "not_found" };

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "action.reexecuted",
    entity: "actions",
    entityId: data.id as string,
    details: { clonedFrom: actionId },
  });
  return { ok: true, id: data.id as string };
}

/**
 * Activa una acción (draft → active): exige fechas y, si es re-ejecución, un
 * código distinto al de origen (task 2.8, el gate). Deja rastro en audit_log.
 */
export async function activateAction(
  principal: Principal,
  actionId: string,
): Promise<ActionMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const guard = tenantGuard(principal.tenantId);

  const { data: action } = await guard.db
    .from("actions")
    .select("id, codigo_accion, starts_on, ends_on, cloned_from")
    .eq("id", actionId)
    .eq("tenant_id", principal.tenantId)
    .maybeSingle();
  if (!action) return { ok: false, error: "not_found" };

  // Si es re-ejecución, el código nuevo debe diferir del de origen.
  let originCode: string | null = null;
  if (action.cloned_from) {
    const { data: origin } = await guard.db
      .from("actions")
      .select("codigo_accion")
      .eq("id", action.cloned_from as string)
      .eq("tenant_id", principal.tenantId)
      .maybeSingle();
    originCode = (origin?.codigo_accion as string | undefined) ?? null;
  }

  const check = validateActivation({
    startsOn: action.starts_on as string | null,
    endsOn: action.ends_on as string | null,
    codigoAccion: action.codigo_accion as string,
    originCode,
  });
  if (!check.ok) return { ok: false, error: check.error };

  const { error } = await guard.db
    .from("actions")
    .update({ status: "active" })
    .eq("id", actionId)
    .eq("tenant_id", principal.tenantId);
  if (error) return { ok: false, error: "not_found" };

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "action.activated",
    entity: "actions",
    entityId: actionId,
    details: { codigoAccion: action.codigo_accion, clonedFrom: action.cloned_from ?? null },
  });
  return { ok: true, id: actionId };
}

/**
 * Fija el código y las fechas de una acción en borrador y la activa en un solo
 * paso (task 2.8): la ruta de la UI para activar una re-ejecución (que nace con
 * el código de origen y sin fechas). Persiste primero los datos en el borrador
 * y luego aplica el gate de `activateAction` (fechas + código ≠ origen).
 */
export async function scheduleAndActivate(
  principal: Principal,
  actionId: string,
  input: { codigoAccion: unknown; startsOn: unknown; endsOn: unknown },
): Promise<ActionMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const guard = tenantGuard(principal.tenantId);

  const { data: current } = await guard.db
    .from("actions")
    .select("id, course_id, training_line, environment, attendance_lock")
    .eq("id", actionId)
    .eq("tenant_id", principal.tenantId)
    .maybeSingle();
  if (!current) return { ok: false, error: "not_found" };

  // Reusa la validación de dominio del formulario (formato de fechas/código, etc.).
  const parsed = parseActionInput({
    courseId: current.course_id,
    codigoAccion: input.codigoAccion,
    trainingLine: current.training_line,
    environment: current.environment,
    attendanceLock: current.attendance_lock,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
  });
  if (!parsed.ok) return { ok: false, validation: parsed.errors };

  // Persiste código + fechas en el BORRADOR (el CHECK admite draft sin/ con fechas).
  const { error } = await guard.db
    .from("actions")
    .update(toRow(parsed.value))
    .eq("id", actionId)
    .eq("tenant_id", principal.tenantId);
  if (error) return { ok: false, error: "not_found" };

  // Aplica el gate real (fechas presentes + código ≠ origen) y activa + audita.
  return activateAction(principal, actionId);
}
