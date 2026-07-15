import "server-only";

import { tenantGuard, type TenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import {
  lateness,
  parseAssignmentInput,
  safeFileSlug,
  validateSubmissionFile,
  type Rubric,
} from "@/modules/evaluacion/domain/assignment";
import type { FieldError } from "@/modules/evaluacion/domain/quiz";

/**
 * Tareas con entrega (task 2.2, HU-6.2): CRUD del instrumento (admin/coord/
 * relator) + entrega del alumno (archivo a Storage privado, historial
 * INSERT-only). Descarga por signed URL tras authorize(); el bucket no tiene
 * policies para `authenticated` (deny-by-default).
 */

const MANAGERS = ["otec_admin", "coordinator", "instructor"] as const;
const BUCKET = "submissions";

export type AssignmentError =
  | "forbidden"
  | "no_tenant"
  | "not_found"
  | "course_not_found"
  | "not_enrolled"
  | "not_published"
  | "file_rejected"
  | "late_rejected"
  | "upload_failed";

export type AssignmentMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: AssignmentError }
  | { ok: false; validation: FieldError[] };

export interface AssignmentRow {
  id: string;
  course_id: string;
  title: string;
  instructions: string;
  status: "draft" | "published";
  due_at: string | null;
  grace_hours: number;
  rubric: Rubric | null;
  passing_pct: number;
  weight: number;
}

export interface SubmissionRow {
  id: string;
  assignment_id: string;
  enrollment_id: string;
  version: number;
  comment: string;
  file_name: string;
  file_size: number;
  late: boolean;
  submitted_at: string;
}

function canManage(p: Principal): boolean {
  return Boolean(p.tenantId) && authorize(p, p.tenantId!, MANAGERS);
}

const A_COLUMNS =
  "id, course_id, title, instructions, status, due_at, grace_hours, rubric, passing_pct, weight";

function toRow(v: ReturnType<typeof parseAssignmentInput> & { ok: true }): Record<string, unknown> {
  const a = v.value;
  return {
    title: a.title,
    instructions: a.instructions,
    due_at: a.dueAt,
    grace_hours: a.graceHours,
    rubric: a.rubric,
    passing_pct: a.passingPct,
    weight: a.weight,
  };
}

export async function listAssignmentsByCourse(
  principal: Principal,
  courseId: string,
): Promise<AssignmentRow[]> {
  if (!canManage(principal)) return [];
  const guard = tenantGuard(principal.tenantId!);
  const { data } = await guard
    .from("assignments")
    .select(A_COLUMNS)
    .eq("course_id", courseId)
    .order("created_at", { ascending: true });
  return (data ?? []) as AssignmentRow[];
}

export async function getAssignment(
  principal: Principal,
  assignmentId: string,
): Promise<AssignmentRow | null> {
  if (!canManage(principal)) return null;
  const guard = tenantGuard(principal.tenantId!);
  const { data } = await guard.from("assignments").select(A_COLUMNS).eq("id", assignmentId).maybeSingle();
  return (data as AssignmentRow | null) ?? null;
}

export async function createAssignment(
  principal: Principal,
  courseId: string,
  raw: Record<string, unknown>,
): Promise<AssignmentMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const parsed = parseAssignmentInput(raw);
  if (!parsed.ok) return { ok: false, validation: parsed.errors };

  const guard = tenantGuard(principal.tenantId);
  const { data: course } = await guard.from("courses").select("id").eq("id", courseId).maybeSingle();
  if (!course) return { ok: false, error: "course_not_found" };

  const { data, error } = await guard.db
    .from("assignments")
    .insert(guard.withTenant({ course_id: courseId, ...toRow(parsed) }))
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "not_found" };
  return { ok: true, id: data.id as string };
}

export async function updateAssignment(
  principal: Principal,
  assignmentId: string,
  raw: Record<string, unknown>,
): Promise<AssignmentMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const parsed = parseAssignmentInput(raw);
  if (!parsed.ok) return { ok: false, validation: parsed.errors };

  const guard = tenantGuard(principal.tenantId);
  const { data, error } = await guard.db
    .from("assignments")
    .update(toRow(parsed))
    .eq("id", assignmentId)
    .eq("tenant_id", principal.tenantId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "not_found" };
  return { ok: true, id: data.id as string };
}

export async function publishAssignment(
  principal: Principal,
  assignmentId: string,
  publish: boolean,
): Promise<AssignmentMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const guard = tenantGuard(principal.tenantId);
  const { error } = await guard.db
    .from("assignments")
    .update({ status: publish ? "published" : "draft" })
    .eq("id", assignmentId)
    .eq("tenant_id", principal.tenantId);
  if (error) return { ok: false, error: "not_found" };
  return { ok: true, id: assignmentId };
}

// ---------- entrega del alumno ----------

async function studentEnrollment(
  guard: TenantGuard,
  userId: string,
  courseId: string,
): Promise<string | null> {
  const { data } = await guard.db
    .from("enrollments")
    .select("id, actions!inner(course_id)")
    .eq("tenant_id", guard.tenantId)
    .eq("user_id", userId)
    .eq("actions.course_id", courseId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export interface SubmitInput {
  readonly file: { name: string; size: number; type: string; bytes: ArrayBuffer };
  readonly comment: string;
  /** Reloj inyectable (tests). */
  readonly now?: number;
}

/** Sube una entrega nueva (versión N+1) al bucket privado. INSERT-only. */
export async function submitAssignment(
  principal: Principal,
  assignmentId: string,
  input: SubmitInput,
): Promise<{ ok: true; id: string; late: boolean } | { ok: false; error: AssignmentError }> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  const guard = tenantGuard(principal.tenantId);

  const { data: assignment } = await guard
    .from("assignments")
    .select("id, course_id, status, due_at, grace_hours")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment) return { ok: false, error: "not_found" };
  if (assignment.status !== "published") return { ok: false, error: "not_published" };

  const enrollmentId = await studentEnrollment(guard, principal.userId, assignment.course_id as string);
  if (!enrollmentId) return { ok: false, error: "not_enrolled" };

  const fileCheck = validateSubmissionFile(input.file);
  if (!fileCheck.ok) return { ok: false, error: "file_rejected" };

  const now = input.now ?? Date.now();
  const late = lateness(
    (assignment.due_at as string | null) ?? null,
    (assignment.grace_hours as number) ?? 0,
    now,
  );
  if (late === "rejected") return { ok: false, error: "late_rejected" };

  // Versión N+1 para (tarea, inscripción).
  const { data: last } = await guard.db
    .from("submissions")
    .select("version")
    .eq("tenant_id", principal.tenantId)
    .eq("assignment_id", assignmentId)
    .eq("enrollment_id", enrollmentId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = ((last?.version as number | undefined) ?? 0) + 1;

  const path = `${principal.tenantId}/${assignmentId}/${enrollmentId}/${version}-${safeFileSlug(input.file.name)}`;
  const { error: uploadError } = await guard.db.storage
    .from(BUCKET)
    .upload(path, input.file.bytes, { contentType: input.file.type, upsert: false });
  if (uploadError) return { ok: false, error: "upload_failed" };

  const { data, error } = await guard.db
    .from("submissions")
    .insert(
      guard.withTenant({
        assignment_id: assignmentId,
        enrollment_id: enrollmentId,
        version,
        comment: input.comment.slice(0, 4000),
        file_path: path,
        file_name: input.file.name.slice(0, 300),
        file_size: input.file.size,
        mime_type: input.file.type,
        late: late === "late",
      }),
    )
    .select("id")
    .single();
  if (error || !data) {
    // El archivo ya subió pero la fila no se creó (p.ej. colisión de versión por
    // entrega concurrente, o error transitorio): borra el objeto para no dejar
    // huérfanos en el bucket. La entrega se reintenta limpia.
    await guard.db.storage.from(BUCKET).remove([path]);
    return { ok: false, error: "upload_failed" };
  }
  return { ok: true, id: data.id as string, late: late === "late" };
}

/** Historial de entregas del alumno para una tarea. */
export async function listMySubmissions(
  principal: Principal,
  assignmentId: string,
): Promise<SubmissionRow[]> {
  if (!principal.tenantId) return [];
  const guard = tenantGuard(principal.tenantId);
  const { data } = await guard.db
    .from("submissions")
    .select("id, assignment_id, enrollment_id, version, comment, file_name, file_size, late, submitted_at, enrollments!inner(user_id)")
    .eq("tenant_id", principal.tenantId)
    .eq("assignment_id", assignmentId)
    .eq("enrollments.user_id", principal.userId)
    .order("version", { ascending: false });
  return (data ?? []) as unknown as SubmissionRow[];
}

export interface StudentAssignmentSummary {
  readonly assignmentId: string;
  readonly title: string;
  readonly dueAt: string | null;
  readonly submissionCount: number;
  readonly grade: number | null;
}

/** Tareas PUBLICADAS de los cursos del alumno + su estado (para /mi-curso). */
export async function listStudentAssignments(
  principal: Principal,
): Promise<StudentAssignmentSummary[]> {
  if (!principal.tenantId) return [];
  const guard = tenantGuard(principal.tenantId);

  const { data: enr } = await guard.db
    .from("enrollments")
    .select("id, actions!inner(course_id)")
    .eq("tenant_id", principal.tenantId)
    .eq("user_id", principal.userId);
  const rows = (enr ?? []) as unknown as { id: string; actions: { course_id: string } }[];
  const enrollmentByCourse = new Map<string, string>();
  for (const r of rows) enrollmentByCourse.set(r.actions.course_id, r.id);
  if (enrollmentByCourse.size === 0) return [];

  const { data: assignments } = await guard.db
    .from("assignments")
    .select("id, course_id, title, due_at")
    .eq("tenant_id", principal.tenantId)
    .eq("status", "published")
    .in("course_id", [...enrollmentByCourse.keys()])
    .order("created_at", { ascending: true });

  const out: StudentAssignmentSummary[] = [];
  for (const a of (assignments ?? []) as {
    id: string;
    course_id: string;
    title: string;
    due_at: string | null;
  }[]) {
    const enrollmentId = enrollmentByCourse.get(a.course_id);
    if (!enrollmentId) continue;
    const [{ count }, { data: grade }] = await Promise.all([
      guard.db
        .from("submissions")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", principal.tenantId)
        .eq("assignment_id", a.id)
        .eq("enrollment_id", enrollmentId),
      guard.db
        .from("grades")
        .select("grade, status")
        .eq("tenant_id", principal.tenantId)
        .eq("assignment_id", a.id)
        .eq("enrollment_id", enrollmentId)
        .eq("status", "published")
        .maybeSingle(),
    ]);
    out.push({
      assignmentId: a.id,
      title: a.title,
      dueAt: a.due_at,
      submissionCount: count ?? 0,
      grade: (grade?.grade as number | null) ?? null,
    });
  }
  return out;
}

export interface StudentAssignmentView {
  readonly assignment: { id: string; title: string; instructions: string; dueAt: string | null };
  readonly submissions: SubmissionRow[];
  readonly grade: { grade: number; feedback: string } | null;
}

/** Vista de una tarea para el alumno (instrucciones + entregas + nota publicada). */
export async function getStudentAssignmentView(
  principal: Principal,
  assignmentId: string,
): Promise<StudentAssignmentView | null> {
  if (!principal.tenantId) return null;
  const guard = tenantGuard(principal.tenantId);

  const { data: assignment } = await guard.db
    .from("assignments")
    .select("id, course_id, title, instructions, due_at, status")
    .eq("tenant_id", principal.tenantId)
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment || assignment.status !== "published") return null;

  const enrollmentId = await studentEnrollment(guard, principal.userId, assignment.course_id as string);
  if (!enrollmentId) return null;

  const [submissions, { data: grade }] = await Promise.all([
    listMySubmissions(principal, assignmentId),
    guard.db
      .from("grades")
      .select("grade, feedback")
      .eq("tenant_id", principal.tenantId)
      .eq("assignment_id", assignmentId)
      .eq("enrollment_id", enrollmentId)
      .eq("status", "published")
      .maybeSingle(),
  ]);

  return {
    assignment: {
      id: assignment.id as string,
      title: assignment.title as string,
      instructions: assignment.instructions as string,
      dueAt: (assignment.due_at as string | null) ?? null,
    },
    submissions,
    grade: grade ? { grade: grade.grade as number, feedback: (grade.feedback as string) ?? "" } : null,
  };
}

/** Signed URL de descarga: dueño de la entrega o staff (authorize primero). */
export async function getSubmissionDownloadUrl(
  principal: Principal,
  submissionId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: AssignmentError }> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  const guard = tenantGuard(principal.tenantId);

  const { data: sub } = await guard.db
    .from("submissions")
    .select("file_path, enrollment_id, enrollments!inner(user_id)")
    .eq("tenant_id", principal.tenantId)
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub) return { ok: false, error: "not_found" };

  const isOwner =
    (sub as unknown as { enrollments: { user_id: string } }).enrollments.user_id === principal.userId;
  if (!isOwner && !canManage(principal)) return { ok: false, error: "forbidden" };

  const { data, error } = await guard.db.storage
    .from(BUCKET)
    .createSignedUrl(sub.file_path as string, 3600);
  if (error || !data) return { ok: false, error: "not_found" };
  return { ok: true, url: data.signedUrl };
}
