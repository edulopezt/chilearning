import "server-only";

import { tenantGuard, type TenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import {
  rubricScore,
  validateDirectGrade,
  type Rubric,
} from "@/modules/evaluacion/domain/assignment";
import { validateGradeChange } from "@/modules/evaluacion/domain/grade-change";
import type { FieldError } from "@/modules/evaluacion/domain/quiz";
import type { EmailSender } from "@/modules/comunicacion/email-sender";

/**
 * Corrección de tareas (task 2.2, HU-6.2 — D-022 §S11/S12):
 *  - saveDraftGrade: instructor Y tutor guardan un borrador de nota.
 *  - publishGrade: SOLO el instructor publica (matriz §3: la nota final la
 *    publica el relator) → aviso al alumno (notifications outbox + correo) +
 *    audit.
 *  - updatePublishedGrade: SOLO instructor; editar una publicada exige MOTIVO
 *    y escribe audit_log `grade.updated {old,new,motivo}` (el gate del hito).
 *
 * Una nota PUBLICADA es un registro oficial: no se revierte a borrador ni se
 * re-publica con otro valor por las rutas de borrador/publicación (devuelven
 * `already_published`); solo `updatePublishedGrade` la cambia, con motivo. La
 * escritura de la nota y su auditoría son ATÓMICAS: van juntas por el RPC
 * `write_assignment_grade` (una sola transacción), de modo que un cambio de
 * nota nunca queda sin rastro (R#39-1/2/3 de la revisión adversarial).
 */

const GRADERS = ["otec_admin", "coordinator", "instructor", "tutor"] as const;
const PUBLISHERS = ["otec_admin", "coordinator", "instructor"] as const;
/** Tamaño de página para lecturas por acción (PostgREST capa en max_rows=1000). */
const PAGE = 1000;

export type GradingError =
  | "forbidden"
  | "no_tenant"
  | "not_found"
  | "invalid_grade"
  | "already_published"
  | "requires_motivo"
  | "write_failed";

export type GradingResult =
  | { ok: true; gradeId: string }
  | { ok: false; error: GradingError }
  | { ok: false; validation: FieldError[] };

export interface PendingSubmission {
  submissionId: string;
  assignmentId: string;
  assignmentTitle: string;
  enrollmentId: string;
  studentName: string;
  version: number;
  late: boolean;
  submittedAt: string;
  gradeId: string | null;
  currentGrade: number | null;
  gradeStatus: "draft" | "published" | null;
}

export interface GradingDeps {
  emailSender?: EmailSender;
}

function canGrade(p: Principal): boolean {
  return Boolean(p.tenantId) && authorize(p, p.tenantId!, GRADERS);
}
function canPublish(p: Principal): boolean {
  return Boolean(p.tenantId) && authorize(p, p.tenantId!, PUBLISHERS);
}

/** Reúne TODAS las páginas de una lectura (evita la truncación silenciosa a 1000). */
async function fetchAll<T>(
  page: (offset: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await page(offset);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Cola de corrección por acción: última versión de cada entrega + su nota. */
export async function listPendingSubmissions(
  principal: Principal,
  actionId: string,
): Promise<PendingSubmission[]> {
  if (!canGrade(principal)) return [];
  const tenantId = principal.tenantId!;
  const guard = tenantGuard(tenantId);

  // Inscripciones de la acción (con nombre snapshot), paginadas.
  const enr = await fetchAll<{ id: string; first_names: string | null; last_names: string | null }>(
    (offset) =>
      guard.db
        .from("enrollments")
        .select("id, first_names, last_names")
        .eq("tenant_id", tenantId)
        .eq("action_id", actionId)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
  );
  if (enr.length === 0) return [];
  const nameById = new Map(
    enr.map((e) => [e.id, `${e.last_names ?? ""} ${e.first_names ?? ""}`.trim() || "—"]),
  );

  // Entregas de la acción: se filtran por el JOIN embebido (enrollments.action_id)
  // en vez de `.in(enrIds)` — evita "URI too long" en cohortes grandes — y se
  // paginan en orden estable (version desc, id) para que la deduplicación por
  // (tarea, inscripción) conserve SIEMPRE la última versión.
  const subs = await fetchAll<{
    id: string;
    assignment_id: string;
    enrollment_id: string;
    version: number;
    late: boolean;
    submitted_at: string;
    assignments: { title: string };
  }>((offset) =>
    guard.db
      .from("submissions")
      .select(
        "id, assignment_id, enrollment_id, version, late, submitted_at, assignments!inner(title), enrollments!inner(action_id)",
      )
      .eq("tenant_id", tenantId)
      .eq("enrollments.action_id", actionId)
      .order("version", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1) as unknown as PromiseLike<{
      data:
        | {
            id: string;
            assignment_id: string;
            enrollment_id: string;
            version: number;
            late: boolean;
            submitted_at: string;
            assignments: { title: string };
          }[]
        | null;
    }>,
  );

  const grades = await fetchAll<{
    id: string;
    assignment_id: string;
    enrollment_id: string;
    grade: number;
    status: string;
  }>((offset) =>
    guard.db
      .from("grades")
      .select("id, assignment_id, enrollment_id, grade, status, enrollments!inner(action_id)")
      .eq("tenant_id", tenantId)
      .eq("source_kind", "assignment")
      .eq("enrollments.action_id", actionId)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1) as unknown as PromiseLike<{
      data:
        | { id: string; assignment_id: string; enrollment_id: string; grade: number; status: string }[]
        | null;
    }>,
  );
  const gradeByKey = new Map(grades.map((g) => [`${g.assignment_id}|${g.enrollment_id}`, g]));

  // Solo la última versión por (tarea, inscripción).
  const seen = new Set<string>();
  const out: PendingSubmission[] = [];
  for (const s of subs) {
    const key = `${s.assignment_id}|${s.enrollment_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const g = gradeByKey.get(key);
    out.push({
      submissionId: s.id,
      assignmentId: s.assignment_id,
      assignmentTitle: s.assignments.title,
      enrollmentId: s.enrollment_id,
      studentName: nameById.get(s.enrollment_id) ?? "—",
      version: s.version,
      late: s.late,
      submittedAt: s.submitted_at,
      gradeId: g?.id ?? null,
      currentGrade: g?.grade ?? null,
      gradeStatus: (g?.status as "draft" | "published" | undefined) ?? null,
    });
  }
  return out;
}

export interface GradeInput {
  /** Nota directa (si la tarea no tiene rúbrica). */
  readonly directGrade?: number;
  /** {criterionId: levelId} si la tarea tiene rúbrica. */
  readonly rubricSelection?: Record<string, string>;
  readonly feedback: string;
}

async function loadSubmissionContext(guard: TenantGuard, submissionId: string) {
  const { data } = await guard.db
    .from("submissions")
    .select("id, assignment_id, enrollment_id, assignments!inner(rubric, passing_pct)")
    .eq("tenant_id", guard.tenantId)
    .eq("id", submissionId)
    .maybeSingle();
  return data as
    | {
        id: string;
        assignment_id: string;
        enrollment_id: string;
        assignments: { rubric: Rubric | null; passing_pct: number };
      }
    | null;
}

/** Nota vigente para (inscripción, tarea): su id y estado, o null si no existe. */
async function loadExistingGrade(
  guard: TenantGuard,
  enrollmentId: string,
  assignmentId: string,
): Promise<{ id: string; status: "draft" | "published" } | null> {
  const { data } = await guard.db
    .from("grades")
    .select("id, status")
    .eq("tenant_id", guard.tenantId)
    .eq("enrollment_id", enrollmentId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id as string, status: data.status as "draft" | "published" };
}

type Computed = {
  grade: number;
  rubricScores: Record<string, string> | null;
  score: number | null;
  maxScore: number | null;
};

function computeGrade(
  assignment: { rubric: Rubric | null; passing_pct: number },
  input: GradeInput,
): Computed | { error: "invalid_grade" } {
  if (assignment.rubric) {
    const selection = input.rubricSelection ?? {};
    const r = rubricScore(assignment.rubric, selection, assignment.passing_pct);
    return { grade: r.grade, rubricScores: selection, score: r.points, maxScore: r.maxPoints };
  }
  const grade = input.directGrade ?? Number.NaN;
  if (!validateDirectGrade(grade).ok) return { error: "invalid_grade" };
  return { grade, rubricScores: null, score: null, maxScore: null };
}

/** Guarda un borrador de nota (instructor o tutor). NO toca una nota publicada. */
export async function saveDraftGrade(
  principal: Principal,
  submissionId: string,
  input: GradeInput,
): Promise<GradingResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canGrade(principal)) return { ok: false, error: "forbidden" };
  const guard = tenantGuard(principal.tenantId);

  const ctx = await loadSubmissionContext(guard, submissionId);
  if (!ctx) return { ok: false, error: "not_found" };

  // Una nota ya publicada NO se pisa con un borrador (P8): se corrige con motivo.
  const existing = await loadExistingGrade(guard, ctx.enrollment_id, ctx.assignment_id);
  if (existing?.status === "published") return { ok: false, error: "already_published" };

  const computed = computeGrade(ctx.assignments, input);
  if ("error" in computed) return { ok: false, error: computed.error };

  const gradeId = await writeAssignmentGrade(guard, {
    enrollmentId: ctx.enrollment_id,
    assignmentId: ctx.assignment_id,
    computed,
    feedback: input.feedback,
    actor: principal.userId,
    publish: false,
    auditAction: null,
    auditDetails: null,
  });
  if (!gradeId) return { ok: false, error: "write_failed" };
  return { ok: true, gradeId };
}

/** Publica la nota (SOLO relator): aviso al alumno + audit. Primera publicación. */
export async function publishGrade(
  principal: Principal,
  submissionId: string,
  input: GradeInput,
  deps: GradingDeps = {},
): Promise<GradingResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canPublish(principal)) return { ok: false, error: "forbidden" };
  const guard = tenantGuard(principal.tenantId);

  const ctx = await loadSubmissionContext(guard, submissionId);
  if (!ctx) return { ok: false, error: "not_found" };

  // Re-publicar una ya publicada con otro valor exige el flujo con motivo.
  const existing = await loadExistingGrade(guard, ctx.enrollment_id, ctx.assignment_id);
  if (existing?.status === "published") return { ok: false, error: "already_published" };

  const computed = computeGrade(ctx.assignments, input);
  if ("error" in computed) return { ok: false, error: computed.error };

  const gradeId = await writeAssignmentGrade(guard, {
    enrollmentId: ctx.enrollment_id,
    assignmentId: ctx.assignment_id,
    computed,
    feedback: input.feedback,
    actor: principal.userId,
    publish: true,
    auditAction: "grade.published",
    auditDetails: {
      assignmentId: ctx.assignment_id,
      enrollmentId: ctx.enrollment_id,
      grade: computed.grade,
    },
  });
  if (!gradeId) return { ok: false, error: "write_failed" };

  // El aviso es outbox best-effort: su fallo no revierte la nota ya publicada.
  await notifyStudent(guard, ctx.enrollment_id, ctx.assignment_id, computed.grade, deps);
  return { ok: true, gradeId };
}

/** Edita una nota YA PUBLICADA (SOLO relator): exige motivo + audit (gate). */
export async function updatePublishedGrade(
  principal: Principal,
  gradeId: string,
  input: GradeInput & { motivo: string | null },
): Promise<GradingResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canPublish(principal)) return { ok: false, error: "forbidden" };
  const guard = tenantGuard(principal.tenantId);

  const { data: existing } = await guard.db
    .from("grades")
    .select("id, status, grade, assignment_id, enrollment_id, assignments:assignment_id(rubric, passing_pct)")
    .eq("tenant_id", principal.tenantId)
    .eq("id", gradeId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "not_found" };
  const assignment = (existing as unknown as { assignments: { rubric: Rubric | null; passing_pct: number } }).assignments;

  const computed = computeGrade(assignment, input);
  if ("error" in computed) return { ok: false, error: "invalid_grade" };

  const change = validateGradeChange({
    currentStatus: existing.status as "draft" | "published",
    nextGrade: computed.grade,
    nextFeedback: input.feedback,
    motivo: input.motivo,
  });
  if (!change.ok) return { ok: false, validation: change.errors };

  // El update de la nota + su auditoría van en UNA transacción (RPC): un fallo
  // del audit revierte el cambio (nunca una nota cambiada sin rastro, P8).
  const written = await writeAssignmentGrade(guard, {
    enrollmentId: existing.enrollment_id as string,
    assignmentId: existing.assignment_id as string,
    computed,
    feedback: input.feedback,
    actor: principal.userId,
    publish: existing.status === "published",
    auditAction: change.requiresAudit ? "grade.updated" : null,
    auditDetails: change.requiresAudit
      ? {
          old: existing.grade,
          new: computed.grade,
          motivo: input.motivo,
          enrollmentId: existing.enrollment_id,
          assignmentId: existing.assignment_id,
        }
      : null,
  });
  if (!written) return { ok: false, error: "write_failed" };
  return { ok: true, gradeId: written };
}

// ---------- internos ----------

/**
 * Escritura ATÓMICA de una nota de tarea + su auditoría vía RPC transaccional.
 * Reemplaza el upsert de dos statements (nota, luego audit) que dejaba el cambio
 * sin rastro si el segundo fallaba. La BD además rechaza mutar una publicada
 * fuera del flujo `grade.updated`. Devuelve el id de la nota o null si falló.
 */
async function writeAssignmentGrade(
  guard: TenantGuard,
  params: {
    enrollmentId: string;
    assignmentId: string;
    computed: Computed;
    feedback: string;
    actor: string;
    publish: boolean;
    auditAction: "grade.published" | "grade.updated" | null;
    auditDetails: Record<string, unknown> | null;
  },
): Promise<string | null> {
  const { data, error } = await guard.db.rpc("write_assignment_grade", {
    p_tenant_id: guard.tenantId,
    p_enrollment_id: params.enrollmentId,
    p_assignment_id: params.assignmentId,
    p_grade: params.computed.grade,
    p_score: params.computed.score,
    p_max_score: params.computed.maxScore,
    p_rubric_scores: params.computed.rubricScores,
    p_feedback: params.feedback.slice(0, 4000),
    p_actor: params.actor,
    p_publish: params.publish,
    p_audit_action: params.auditAction,
    p_audit_details: params.auditDetails ?? {},
  });
  if (error || !data) {
    if (error) {
      console.error("[grading] write_assignment_grade falló", { message: error.message });
    }
    return null;
  }
  return data as string;
}

/** Aviso al alumno (S12): outbox in-app + correo real vía EmailSender. */
async function notifyStudent(
  guard: TenantGuard,
  enrollmentId: string,
  assignmentId: string,
  grade: number,
  deps: GradingDeps,
): Promise<void> {
  const { data: enrollment } = await guard.db
    .from("enrollments")
    .select("user_id")
    .eq("tenant_id", guard.tenantId)
    .eq("id", enrollmentId)
    .maybeSingle();
  const userId = enrollment?.user_id as string | undefined;
  if (!userId) return;

  const { data: inserted } = await guard.db
    .from("notifications")
    .insert(
      guard.withTenant({
        user_id: userId,
        kind: "grade.published",
        payload: { assignmentId, grade },
      }),
    )
    .select("id")
    .single();
  const notificationId = inserted?.id as string | undefined;

  const sender = deps.emailSender;
  if (!sender?.configured) return;
  const { data: user } = await guard.db.auth.admin.getUserById(userId);
  const email = user?.user?.email;
  if (!email) return;
  const result = await sender.send({
    to: email,
    subject: "Tienes una nota nueva en Chilearning",
    html: `<p>Tu tarea fue corregida. Ingresa a tu curso para ver tu nota y la retroalimentación.</p>`,
    text: "Tu tarea fue corregida. Ingresa a tu curso para ver tu nota y la retroalimentación.",
  });
  // Marca ESTA notificación como enviada (por id — no todas las del usuario).
  if (result.ok && notificationId) {
    await guard.db
      .from("notifications")
      .update({ status: "sent" })
      .eq("tenant_id", guard.tenantId)
      .eq("id", notificationId);
  }
}
