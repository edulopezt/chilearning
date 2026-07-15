import "server-only";

import { writeAudit } from "@/lib/audit";
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
 */

const GRADERS = ["otec_admin", "coordinator", "instructor", "tutor"] as const;
const PUBLISHERS = ["otec_admin", "coordinator", "instructor"] as const;

export type GradingError =
  | "forbidden"
  | "no_tenant"
  | "not_found"
  | "invalid_grade"
  | "requires_motivo";

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

/** Cola de corrección por acción: última versión de cada entrega + su nota. */
export async function listPendingSubmissions(
  principal: Principal,
  actionId: string,
): Promise<PendingSubmission[]> {
  if (!canGrade(principal)) return [];
  const guard = tenantGuard(principal.tenantId!);

  // Inscripciones de la acción (con nombre snapshot).
  const { data: enrollments } = await guard.db
    .from("enrollments")
    .select("id, first_names, last_names")
    .eq("tenant_id", principal.tenantId!)
    .eq("action_id", actionId);
  const enr = (enrollments ?? []) as {
    id: string;
    first_names: string | null;
    last_names: string | null;
  }[];
  if (enr.length === 0) return [];
  const enrIds = enr.map((e) => e.id);
  const nameById = new Map(
    enr.map((e) => [e.id, `${e.last_names ?? ""} ${e.first_names ?? ""}`.trim() || "—"]),
  );

  const { data: subs } = await guard.db
    .from("submissions")
    .select("id, assignment_id, enrollment_id, version, late, submitted_at, assignments!inner(title)")
    .eq("tenant_id", principal.tenantId!)
    .in("enrollment_id", enrIds)
    .order("version", { ascending: false });

  const { data: grades } = await guard.db
    .from("grades")
    .select("assignment_id, enrollment_id, grade, status")
    .eq("tenant_id", principal.tenantId!)
    .eq("source_kind", "assignment")
    .in("enrollment_id", enrIds);
  const gradeByKey = new Map(
    ((grades ?? []) as { assignment_id: string; enrollment_id: string; grade: number; status: string }[]).map(
      (g) => [`${g.assignment_id}|${g.enrollment_id}`, g],
    ),
  );

  // Solo la última versión por (tarea, inscripción).
  const seen = new Set<string>();
  const out: PendingSubmission[] = [];
  for (const s of (subs ?? []) as unknown as {
    id: string;
    assignment_id: string;
    enrollment_id: string;
    version: number;
    late: boolean;
    submitted_at: string;
    assignments: { title: string };
  }[]) {
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

function computeGrade(
  assignment: { rubric: Rubric | null; passing_pct: number },
  input: GradeInput,
): { grade: number; rubricScores: Record<string, string> | null; score: number | null; maxScore: number | null } | { error: "invalid_grade" } {
  if (assignment.rubric) {
    const selection = input.rubricSelection ?? {};
    const r = rubricScore(assignment.rubric, selection, assignment.passing_pct);
    return { grade: r.grade, rubricScores: selection, score: r.points, maxScore: r.maxPoints };
  }
  const grade = input.directGrade ?? Number.NaN;
  if (!validateDirectGrade(grade).ok) return { error: "invalid_grade" };
  return { grade, rubricScores: null, score: null, maxScore: null };
}

/** Guarda un borrador de nota (instructor o tutor). */
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
  const computed = computeGrade(ctx.assignments, input);
  if ("error" in computed) return { ok: false, error: computed.error };

  const gradeId = await upsertGrade(guard, principal, ctx, computed, input.feedback, "draft");
  if (!gradeId) return { ok: false, error: "not_found" };
  return { ok: true, gradeId };
}

/** Publica la nota (SOLO relator): aviso al alumno + audit. */
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
  const computed = computeGrade(ctx.assignments, input);
  if ("error" in computed) return { ok: false, error: computed.error };

  const gradeId = await upsertGrade(guard, principal, ctx, computed, input.feedback, "published");
  if (!gradeId) return { ok: false, error: "not_found" };

  await notifyStudent(guard, ctx.enrollment_id, ctx.assignment_id, computed.grade, deps);
  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "grade.published",
    entity: "grades",
    entityId: gradeId,
    details: { assignmentId: ctx.assignment_id, enrollmentId: ctx.enrollment_id, grade: computed.grade },
  });
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

  const { error } = await guard.db
    .from("grades")
    .update({
      grade: computed.grade,
      score: computed.score,
      max_score: computed.maxScore,
      rubric_scores: computed.rubricScores,
      feedback: input.feedback.slice(0, 4000),
    })
    .eq("id", gradeId)
    .eq("tenant_id", principal.tenantId);
  if (error) return { ok: false, error: "not_found" };

  if (change.requiresAudit) {
    await writeAudit(guard, {
      actorUserId: principal.userId,
      action: "grade.updated",
      entity: "grades",
      entityId: gradeId,
      details: {
        old: existing.grade,
        new: computed.grade,
        motivo: input.motivo,
        enrollmentId: existing.enrollment_id,
        assignmentId: existing.assignment_id,
      },
    });
  }
  return { ok: true, gradeId };
}

// ---------- internos ----------

async function upsertGrade(
  guard: TenantGuard,
  principal: Principal,
  ctx: { assignment_id: string; enrollment_id: string },
  computed: { grade: number; rubricScores: Record<string, string> | null; score: number | null; maxScore: number | null },
  feedback: string,
  status: "draft" | "published",
): Promise<string | null> {
  const { data: existing } = await guard.db
    .from("grades")
    .select("id")
    .eq("tenant_id", guard.tenantId)
    .eq("enrollment_id", ctx.enrollment_id)
    .eq("assignment_id", ctx.assignment_id)
    .maybeSingle();

  const now = new Date().toISOString();
  const base = {
    grade: computed.grade,
    score: computed.score,
    max_score: computed.maxScore,
    rubric_scores: computed.rubricScores,
    feedback: feedback.slice(0, 4000),
    graded_by: principal.userId,
    status,
    ...(status === "published" ? { published_by: principal.userId, published_at: now } : {}),
  };

  if (existing) {
    const { error } = await guard.db
      .from("grades")
      .update(base)
      .eq("id", existing.id as string)
      .eq("tenant_id", guard.tenantId);
    return error ? null : (existing.id as string);
  }
  const { data, error } = await guard.db
    .from("grades")
    .insert(guard.withTenant({ enrollment_id: ctx.enrollment_id, source_kind: "assignment", assignment_id: ctx.assignment_id, ...base }))
    .select("id")
    .single();
  return error || !data ? null : (data.id as string);
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

  await guard.db.from("notifications").insert(
    guard.withTenant({
      user_id: userId,
      kind: "grade.published",
      payload: { assignmentId, grade },
    }),
  );

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
  if (result.ok) {
    // Marca la notificación como enviada (la última pendiente de este usuario).
    await guard.db
      .from("notifications")
      .update({ status: "sent" })
      .eq("tenant_id", guard.tenantId)
      .eq("user_id", userId)
      .eq("status", "pending");
  }
}
