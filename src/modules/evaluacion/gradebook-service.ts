import "server-only";

import { tenantGuard, type TenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import {
  consolidate,
  gradebookToCsv,
  type CsvLabels,
  type Gradebook,
  type GradebookInstrument,
  type GradebookStudent,
} from "@/modules/evaluacion/domain/gradebook";
import { PASSING_GRADE } from "@/modules/evaluacion/domain/scale";

/**
 * Libro de notas por acción (task 2.3, HU-6.4 — el GATE del hito). Consolida las
 * notas PUBLICADAS de los instrumentos (quizzes + tareas) del curso, por
 * inscripción, con promedio ponderado parcial (D-022 §S10). Lectura agregada vía
 * tenantGuard para relator/coordinador/admin/tutor. El HISTORIAL de cambios de
 * nota (audit_log `grade.updated`) es la auditoría del gate; solo el otec_admin.
 */

const VIEWERS = ["otec_admin", "coordinator", "instructor", "tutor"] as const;
const HISTORY_VIEWERS = ["otec_admin"] as const;
const PAGE = 1000;
const HISTORY_LIMIT = 200;

async function fetchAll<T>(page: (offset: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await page(offset);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export interface GradebookActionSummary {
  readonly actionId: string;
  readonly courseName: string;
  readonly code: string;
}

/** Índice de acciones para elegir su libro de notas (staff que califica). */
export async function listGradebookActions(
  principal: Principal,
): Promise<GradebookActionSummary[]> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, VIEWERS)) return [];
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const [actions, courses] = await Promise.all([
    fetchAll<{ id: string; course_id: string; codigo_accion: string }>((offset) =>
      guard.db
        .from("actions")
        .select("id, course_id, codigo_accion")
        .eq("tenant_id", tenantId)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
    ),
    fetchAll<{ id: string; name: string }>((offset) =>
      guard.db
        .from("courses")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
    ),
  ]);
  const courseName = new Map(courses.map((c) => [c.id, c.name]));
  return actions.map((a) => ({
    actionId: a.id,
    courseName: courseName.get(a.course_id) ?? "—",
    code: a.codigo_accion,
  }));
}

export interface GradebookView {
  readonly actionId: string;
  readonly courseName: string;
  readonly code: string;
  readonly minGrade: number;
  readonly gradebook: Gradebook;
}

function studentName(first: string | null, last: string | null): string {
  return last ? `${last}, ${first ?? ""}`.replace(/,\s*$/, "") : (first ?? "").trim() || "—";
}

function parseMinGrade(completionRules: unknown): number {
  const raw = (completionRules as { minGrade?: unknown } | null)?.minGrade;
  return typeof raw === "number" && raw >= 1 && raw <= 7 ? raw : PASSING_GRADE;
}

async function loadInstruments(
  guard: TenantGuard,
  tenantId: string,
  courseId: string,
): Promise<GradebookInstrument[]> {
  const [quizzes, assignments] = await Promise.all([
    fetchAll<{ id: string; title: string; weight: number }>((offset) =>
      guard.db
        .from("quizzes")
        .select("id, title, weight")
        .eq("tenant_id", tenantId)
        .eq("course_id", courseId)
        .eq("status", "published")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
    ),
    fetchAll<{ id: string; title: string; weight: number }>((offset) =>
      guard.db
        .from("assignments")
        .select("id, title, weight")
        .eq("tenant_id", tenantId)
        .eq("course_id", courseId)
        .eq("status", "published")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
    ),
  ]);
  return [
    ...quizzes.map((q) => ({ id: q.id, kind: "quiz" as const, title: q.title, weight: Number(q.weight) })),
    ...assignments.map((a) => ({ id: a.id, kind: "assignment" as const, title: a.title, weight: Number(a.weight) })),
  ];
}

/** Notas publicadas de la acción → mapa inscripción → (instrumento → nota). */
async function loadPublishedGrades(
  guard: TenantGuard,
  tenantId: string,
  actionId: string,
): Promise<Map<string, Map<string, number>>> {
  const grades = await fetchAll<{
    enrollment_id: string;
    quiz_id: string | null;
    assignment_id: string | null;
    grade: number;
  }>((offset) =>
    guard.db
      .from("grades")
      .select("enrollment_id, quiz_id, assignment_id, grade, enrollments!inner(action_id)")
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      .eq("enrollments.action_id", actionId)
      // Desempate único `id`: sin él, la paginación OFFSET sobre enrollment_id
      // (no único) puede saltarse una nota en el borde de página (>1000 notas).
      .order("enrollment_id", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1) as unknown as PromiseLike<{
      data: { enrollment_id: string; quiz_id: string | null; assignment_id: string | null; grade: number }[] | null;
    }>,
  );
  const byEnrollment = new Map<string, Map<string, number>>();
  for (const g of grades) {
    const instrumentId = g.quiz_id ?? g.assignment_id;
    if (!instrumentId) continue;
    let m = byEnrollment.get(g.enrollment_id);
    if (!m) {
      m = new Map();
      byEnrollment.set(g.enrollment_id, m);
    }
    m.set(instrumentId, Number(g.grade));
  }
  return byEnrollment;
}

export async function getGradebook(
  principal: Principal,
  actionId: string,
): Promise<GradebookView | null> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, VIEWERS)) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  const { data: action } = await guard.db
    .from("actions")
    .select("id, codigo_accion, course_id, courses!inner(name, completion_rules)")
    .eq("tenant_id", tenantId)
    .eq("id", actionId)
    .maybeSingle();
  if (!action) return null;
  const course = (action as unknown as { courses: { name: string; completion_rules: unknown } }).courses;

  const [instruments, enr, gradesByEnrollment] = await Promise.all([
    loadInstruments(guard, tenantId, action.course_id as string),
    fetchAll<{ id: string; first_names: string | null; last_names: string | null; run: string | null }>((offset) =>
      guard.db
        .from("enrollments")
        .select("id, first_names, last_names, run")
        .eq("tenant_id", tenantId)
        .eq("action_id", actionId)
        .order("last_names", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
    ),
    loadPublishedGrades(guard, tenantId, actionId),
  ]);

  const students: GradebookStudent[] = enr.map((e) => ({
    enrollmentId: e.id,
    name: studentName(e.first_names, e.last_names),
    run: e.run ?? "",
    grades: gradesByEnrollment.get(e.id) ?? new Map(),
  }));

  const minGrade = parseMinGrade(course.completion_rules);
  return {
    actionId,
    courseName: course.name,
    code: action.codigo_accion as string,
    minGrade,
    gradebook: consolidate(instruments, students, minGrade),
  };
}

export async function getGradebookCsv(
  principal: Principal,
  actionId: string,
  labels: CsvLabels,
): Promise<{ filename: string; csv: string } | null> {
  const view = await getGradebook(principal, actionId);
  if (!view) return null;
  const safeCode = view.code.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40);
  return { filename: `notas-${safeCode}`, csv: gradebookToCsv(view.gradebook, labels) };
}

export interface GradeHistoryEntry {
  readonly gradeId: string;
  readonly studentName: string;
  readonly instrument: string;
  readonly oldGrade: number | null;
  readonly newGrade: number | null;
  readonly motivo: string;
  readonly actor: string;
  readonly at: string;
}

/**
 * Historial de CAMBIOS de nota de la acción (audit_log `grade.updated`), el gate
 * de auditoría de HU-6.4. Solo el otec_admin (coincide con la RLS de audit_log).
 */
export async function getGradeHistory(
  principal: Principal,
  actionId: string,
): Promise<GradeHistoryEntry[]> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, HISTORY_VIEWERS)) return [];
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  const { data: action } = await guard.db
    .from("actions")
    .select("id, course_id")
    .eq("tenant_id", tenantId)
    .eq("id", actionId)
    .maybeSingle();
  if (!action) return [];

  // Nombres de las inscripciones + títulos de instrumentos del curso.
  const [enr, instruments, gradeRows] = await Promise.all([
    fetchAll<{ id: string; first_names: string | null; last_names: string | null }>((offset) =>
      guard.db
        .from("enrollments")
        .select("id, first_names, last_names")
        .eq("tenant_id", tenantId)
        .eq("action_id", actionId)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
    ),
    loadInstruments(guard, tenantId, action.course_id as string),
    fetchAll<{ id: string; enrollment_id: string; quiz_id: string | null; assignment_id: string | null }>((offset) =>
      guard.db
        .from("grades")
        .select("id, enrollment_id, quiz_id, assignment_id, enrollments!inner(action_id)")
        .eq("tenant_id", tenantId)
        .eq("enrollments.action_id", actionId)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1) as unknown as PromiseLike<{
        data: { id: string; enrollment_id: string; quiz_id: string | null; assignment_id: string | null }[] | null;
      }>,
    ),
  ]);

  const nameByEnrollment = new Map(enr.map((e) => [e.id, studentName(e.first_names, e.last_names)]));
  const titleById = new Map(instruments.map((i) => [i.id, i.title]));
  const gradeMeta = new Map(
    gradeRows.map((g) => [
      g.id,
      { enrollmentId: g.enrollment_id, instrumentId: (g.quiz_id ?? g.assignment_id) as string | null },
    ]),
  );
  const gradeIds = new Set(gradeRows.map((g) => g.id));
  if (gradeIds.size === 0) return [];

  // audit_log de cambios de nota (grade.updated), recientes primero.
  const audits = await fetchAll<{
    entity_id: string;
    actor_user_id: string | null;
    details: { old?: number | null; new?: number | null; motivo?: string } | null;
    created_at: string;
  }>((offset) =>
    guard.db
      .from("audit_log")
      .select("entity_id, actor_user_id, details, created_at")
      .eq("tenant_id", tenantId)
      .eq("action", "grade.updated")
      .eq("entity", "grades")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + PAGE - 1),
  );

  const relevant = audits.filter((a) => gradeIds.has(a.entity_id)).slice(0, HISTORY_LIMIT);
  const actorEmail = await resolveActorEmails(guard, relevant.map((a) => a.actor_user_id));

  return relevant.map((a) => {
    const meta = gradeMeta.get(a.entity_id);
    const instrumentId = meta?.instrumentId ?? null;
    return {
      gradeId: a.entity_id,
      studentName: meta ? (nameByEnrollment.get(meta.enrollmentId) ?? "—") : "—",
      instrument: instrumentId ? (titleById.get(instrumentId) ?? "—") : "—",
      oldGrade: typeof a.details?.old === "number" ? a.details.old : null,
      newGrade: typeof a.details?.new === "number" ? a.details.new : null,
      motivo: a.details?.motivo ?? "",
      actor: (a.actor_user_id && actorEmail.get(a.actor_user_id)) || "—",
      at: a.created_at,
    };
  });
}

/** Resuelve el correo de los actores (staff) una sola vez por id único. */
async function resolveActorEmails(
  guard: TenantGuard,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const out = new Map<string, string>();
  await Promise.all(
    unique.map(async (id) => {
      const { data } = await guard.db.auth.admin.getUserById(id);
      const email = data?.user?.email;
      if (email) out.set(id, email);
    }),
  );
  return out;
}
