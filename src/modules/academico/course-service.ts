import "server-only";

import { writeAudit } from "@/lib/audit";
import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { parseCourseInput, type CourseInput, type FieldError } from "@/modules/academico/domain/course";

/**
 * CRUD de cursos (task 1.1, HU-3.1/4.4). Escrituras vía service-role bajo
 * tenantGuard, autorizadas a otec_admin/coordinator (matriz §3). La lectura la
 * cubre la RLS; aquí se lee también por tenantGuard para el panel de gestión.
 */

export interface CourseRow {
  id: string;
  name: string;
  modality: string;
  hours: number;
  sence: boolean;
  cod_sence: string | null;
  status: string;
  completion_rules: unknown;
  /** Vigencia del certificado en meses; null = no vence (task 5.12, HU-7.3). */
  validity_months: number | null;
}

export type CourseServiceError = "forbidden" | "no_tenant" | "not_found";
export type MutationResult =
  | { ok: true; id: string }
  | { ok: false; error: CourseServiceError }
  | { ok: false; validation: FieldError[] };

const MANAGERS = ["otec_admin", "coordinator"] as const;

function canManage(p: Principal): boolean {
  return Boolean(p.tenantId) && authorize(p, p.tenantId!, MANAGERS);
}

function toRow(value: CourseInput): Record<string, unknown> {
  return {
    name: value.name,
    modality: value.modality,
    hours: value.hours,
    sence: value.sence,
    cod_sence: value.codSence,
    completion_rules: value.completionRules,
    status: value.status,
    validity_months: value.validityMonths,
  };
}

export async function listCourses(principal: Principal): Promise<CourseRow[]> {
  if (!principal.tenantId || !canManage(principal)) return [];
  const guard = tenantGuard(principal.tenantId);
  const { data } = await guard
    .from("courses")
    .select("id, name, modality, hours, sence, cod_sence, status, completion_rules, validity_months");
  return (data ?? []) as CourseRow[];
}

/**
 * Clona un curso completo (contenido + instrumentos) en el mismo tenant vía el
 * RPC transaccional `clone_course` (task 2.8, HU-3.6). La copia nace en borrador
 * y SIN acciones/inscripciones. Devuelve el id del curso nuevo.
 */
export async function cloneCourse(
  principal: Principal,
  courseId: string,
): Promise<MutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const guard = tenantGuard(principal.tenantId);

  // El curso debe existir en el tenant (el RPC lo re-verifica; esto da un error
  // limpio y evita invocar el RPC en vano).
  const { data: course } = await guard
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return { ok: false, error: "not_found" };

  const { data, error } = await guard.db.rpc("clone_course", {
    p_tenant_id: principal.tenantId,
    p_course_id: courseId,
  });
  if (error || !data) {
    if (error) console.error("[course] clone_course falló", { message: error.message });
    return { ok: false, error: "not_found" };
  }
  const newCourseId = data as string;

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "course.cloned",
    entity: "courses",
    entityId: newCourseId,
    details: { source: courseId },
  });
  return { ok: true, id: newCourseId };
}

export async function createCourse(
  principal: Principal,
  raw: Record<string, unknown>,
): Promise<MutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };

  const parsed = parseCourseInput(raw);
  if (!parsed.ok) return { ok: false, validation: parsed.errors };

  const guard = tenantGuard(principal.tenantId);
  const { data, error } = await guard.db
    .from("courses")
    .insert(guard.withTenant(toRow(parsed.value)))
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "not_found" };
  return { ok: true, id: data.id as string };
}

export async function updateCourse(
  principal: Principal,
  courseId: string,
  raw: Record<string, unknown>,
): Promise<MutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };

  const parsed = parseCourseInput(raw);
  if (!parsed.ok) return { ok: false, validation: parsed.errors };

  const guard = tenantGuard(principal.tenantId);
  // El filtro por tenant_id impide editar cursos de otro tenant (aislamiento).
  const { data, error } = await guard.db
    .from("courses")
    .update(toRow(parsed.value))
    .eq("id", courseId)
    .eq("tenant_id", principal.tenantId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: "not_found" };
  if (!data) return { ok: false, error: "not_found" };
  return { ok: true, id: data.id as string };
}
