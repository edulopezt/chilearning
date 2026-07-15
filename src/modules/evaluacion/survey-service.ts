import "server-only";

import { writeAudit } from "@/lib/audit";
import { tenantGuard, type TenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import {
  aggregateSurvey,
  parseSurveyInput,
  surveyResultsRows,
  validateAnswers,
  type FieldError,
  type SurveyAggregate,
  type SurveyAnswers,
  type SurveyCsvLabels,
  type SurveyInput,
  type SurveyQuestion,
} from "@/modules/evaluacion/domain/survey";

/**
 * Encuesta de satisfacción (task 3.1, HU-6.3). CRUD de la plantilla (staff),
 * envío del alumno (RPC atómico anti-duplicado), agregados por acción y el
 * helper `hasCompletedSurvey` que consume el gate de certificados (3.2).
 */

const MANAGERS = ["otec_admin", "coordinator", "instructor"] as const;
const RESULT_VIEWERS = MANAGERS;
const PAGE = 1000;

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

interface SurveyRow {
  id: string;
  course_id: string;
  title: string;
  intro: string;
  anonymous: boolean;
  status: string;
  questions: unknown;
}

/** Extrae el arreglo de preguntas del jsonb `{questions:[...]}` almacenado. */
function readQuestions(raw: unknown): SurveyQuestion[] {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as { questions?: unknown };
  return Array.isArray(obj.questions) ? (obj.questions as SurveyQuestion[]) : [];
}

export interface SurveySummary {
  readonly id: string;
  readonly courseId: string;
  readonly title: string;
  readonly intro: string;
  readonly anonymous: boolean;
  readonly status: string;
  readonly questions: readonly SurveyQuestion[];
}

function toSummary(row: SurveyRow): SurveySummary {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    intro: row.intro,
    anonymous: row.anonymous,
    status: row.status,
    questions: readQuestions(row.questions),
  };
}

export async function listSurveysByCourse(
  principal: Principal,
  courseId: string,
): Promise<SurveySummary[]> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, MANAGERS)) return [];
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const rows = await fetchAll<SurveyRow>((offset) =>
    guard.db
      .from("surveys")
      .select("id, course_id, title, intro, anonymous, status, questions")
      .eq("tenant_id", tenantId)
      .eq("course_id", courseId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1),
  );
  return rows.map(toSummary);
}

export async function getSurvey(principal: Principal, surveyId: string): Promise<SurveySummary | null> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, MANAGERS)) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data } = await guard.db
    .from("surveys")
    .select("id, course_id, title, intro, anonymous, status, questions")
    .eq("tenant_id", tenantId)
    .eq("id", surveyId)
    .maybeSingle();
  return data ? toSummary(data as SurveyRow) : null;
}

export type SurveyWriteResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly error: "forbidden" | "invalid"; readonly errors?: FieldError[] };

async function upsertSurvey(
  principal: Principal,
  courseId: string,
  surveyId: string | null,
  raw: Record<string, unknown>,
): Promise<SurveyWriteResult> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, MANAGERS)) {
    return { ok: false, error: "forbidden" };
  }
  const parsed = parseSurveyInput(raw);
  if (!parsed.ok) return { ok: false, error: "invalid", errors: parsed.errors };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const value: SurveyInput = parsed.value;
  const payload = {
    course_id: courseId,
    title: value.title,
    intro: value.intro,
    anonymous: value.anonymous,
    questions: { questions: value.questions },
  };

  if (surveyId) {
    const { data, error } = await guard.db
      .from("surveys")
      .update(payload)
      .eq("tenant_id", tenantId)
      .eq("id", surveyId)
      .select("id")
      .maybeSingle();
    if (error || !data) return { ok: false, error: "forbidden" };
    await writeAudit(guard, {
      actorUserId: principal.userId,
      action: "survey.updated",
      entity: "surveys",
      entityId: surveyId,
      details: { title: value.title },
    });
    return { ok: true, id: surveyId };
  }

  const { data, error } = await guard.db
    .from("surveys")
    .insert(guard.withTenant(payload))
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "forbidden" };
  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "survey.created",
    entity: "surveys",
    entityId: data.id as string,
    details: { title: value.title, courseId },
  });
  return { ok: true, id: data.id as string };
}

export function createSurvey(
  principal: Principal,
  courseId: string,
  raw: Record<string, unknown>,
): Promise<SurveyWriteResult> {
  return upsertSurvey(principal, courseId, null, raw);
}

export function updateSurvey(
  principal: Principal,
  surveyId: string,
  courseId: string,
  raw: Record<string, unknown>,
): Promise<SurveyWriteResult> {
  return upsertSurvey(principal, courseId, surveyId, raw);
}

export async function publishSurvey(
  principal: Principal,
  surveyId: string,
  publish: boolean,
): Promise<{ ok: boolean }> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, MANAGERS)) return { ok: false };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data, error } = await guard.db
    .from("surveys")
    .update({ status: publish ? "published" : "draft" })
    .eq("tenant_id", tenantId)
    .eq("id", surveyId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false };
  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: publish ? "survey.published" : "survey.unpublished",
    entity: "surveys",
    entityId: surveyId,
  });
  return { ok: true };
}

// ---------- alumno: ver y responder ----------

export interface StudentSurveyView {
  readonly survey: SurveySummary;
  readonly alreadySubmitted: boolean;
  readonly enrollmentId: string;
}

/** Busca la inscripción del alumno en un curso (por su usuario). */
async function studentEnrollmentForCourse(
  guard: TenantGuard,
  tenantId: string,
  courseId: string,
  userId: string,
): Promise<string | null> {
  const { data } = await guard.db
    .from("enrollments")
    .select("id, actions!inner(course_id)")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("actions.course_id", courseId)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? (data.id as string) : null;
}

export async function getStudentSurvey(
  principal: Principal,
  surveyId: string,
): Promise<StudentSurveyView | null> {
  if (!principal.tenantId) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data: row } = await guard.db
    .from("surveys")
    .select("id, course_id, title, intro, anonymous, status, questions")
    .eq("tenant_id", tenantId)
    .eq("id", surveyId)
    .eq("status", "published")
    .maybeSingle();
  if (!row) return null;
  const survey = toSummary(row as SurveyRow);
  const enrollmentId = await studentEnrollmentForCourse(guard, tenantId, survey.courseId, principal.userId);
  if (!enrollmentId) return null;
  const { data: sub } = await guard.db
    .from("survey_submissions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("survey_id", surveyId)
    .eq("enrollment_id", enrollmentId)
    .maybeSingle();
  return { survey, alreadySubmitted: Boolean(sub), enrollmentId };
}

export interface StudentSurveyListItem {
  readonly surveyId: string;
  readonly title: string;
  readonly alreadySubmitted: boolean;
}

/** Encuestas publicadas de los cursos en que el alumno está inscrito. */
export async function listStudentSurveys(principal: Principal): Promise<StudentSurveyListItem[]> {
  if (!principal.tenantId) return [];
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  const enrollments = await fetchAll<{ id: string; action_id: string }>((offset) =>
    guard.db
      .from("enrollments")
      .select("id, action_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", principal.userId)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1),
  );
  if (enrollments.length === 0) return [];
  const actionIds = [...new Set(enrollments.map((e) => e.action_id))];

  const actions = await fetchAll<{ id: string; course_id: string }>((offset) =>
    guard.db
      .from("actions")
      .select("id, course_id")
      .eq("tenant_id", tenantId)
      .in("id", actionIds)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1),
  );
  const actionToCourse = new Map(actions.map((a) => [a.id, a.course_id]));
  const courseToEnrollment = new Map<string, string>();
  for (const e of enrollments) {
    const courseId = actionToCourse.get(e.action_id);
    if (courseId && !courseToEnrollment.has(courseId)) courseToEnrollment.set(courseId, e.id);
  }
  const courseIds = [...courseToEnrollment.keys()];
  if (courseIds.length === 0) return [];

  const surveys = await fetchAll<{ id: string; title: string; course_id: string }>((offset) =>
    guard.db
      .from("surveys")
      .select("id, title, course_id")
      .eq("tenant_id", tenantId)
      .in("course_id", courseIds)
      .eq("status", "published")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1),
  );
  if (surveys.length === 0) return [];

  const enrollmentIds = enrollments.map((e) => e.id);
  const submissions = await fetchAll<{ survey_id: string }>((offset) =>
    guard.db
      .from("survey_submissions")
      .select("survey_id")
      .eq("tenant_id", tenantId)
      .in("enrollment_id", enrollmentIds)
      .in("survey_id", surveys.map((s) => s.id))
      .order("survey_id", { ascending: true })
      .range(offset, offset + PAGE - 1),
  );
  const submitted = new Set(submissions.map((s) => s.survey_id));

  return surveys.map((s) => ({ surveyId: s.id, title: s.title, alreadySubmitted: submitted.has(s.id) }));
}

export type SubmitSurveyResult =
  | { readonly ok: true; readonly responseId: string }
  | {
      readonly ok: false;
      readonly error: "not_enrolled" | "not_published" | "already_submitted" | "invalid";
      readonly errors?: FieldError[];
    };

export async function submitSurvey(
  principal: Principal,
  surveyId: string,
  rawAnswers: unknown,
): Promise<SubmitSurveyResult> {
  if (!principal.tenantId) return { ok: false, error: "not_enrolled" };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  const { data: row } = await guard.db
    .from("surveys")
    .select("id, course_id, title, intro, anonymous, status, questions")
    .eq("tenant_id", tenantId)
    .eq("id", surveyId)
    .maybeSingle();
  if (!row || (row as SurveyRow).status !== "published") return { ok: false, error: "not_published" };
  const survey = toSummary(row as SurveyRow);

  const enrollmentId = await studentEnrollmentForCourse(guard, tenantId, survey.courseId, principal.userId);
  if (!enrollmentId) return { ok: false, error: "not_enrolled" };

  const { data: existing } = await guard.db
    .from("survey_submissions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("survey_id", surveyId)
    .eq("enrollment_id", enrollmentId)
    .maybeSingle();
  if (existing) return { ok: false, error: "already_submitted" };

  const validated = validateAnswers(survey.questions, rawAnswers);
  if (!validated.ok) return { ok: false, error: "invalid", errors: validated.errors };

  // La acción (cohorte) de esta inscripción, para agregar por acción.
  const { data: enr } = await guard.db
    .from("enrollments")
    .select("action_id")
    .eq("tenant_id", tenantId)
    .eq("id", enrollmentId)
    .maybeSingle();
  const actionId = enr?.action_id as string | undefined;

  const { data: responseId, error } = await guard.db.rpc("submit_survey", {
    p_tenant_id: tenantId,
    p_survey_id: surveyId,
    p_action_id: actionId ?? null,
    p_enrollment_id: enrollmentId,
    p_anonymous: survey.anonymous,
    p_answers: validated.value as SurveyAnswers,
  });
  if (error) {
    // 23505 = unique_violation del ledger (carrera de doble envío).
    if (error.code === "23505") return { ok: false, error: "already_submitted" };
    return { ok: false, error: "not_published" };
  }
  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "survey.responded",
    entity: "surveys",
    entityId: surveyId,
    details: { anonymous: survey.anonymous },
  });
  return { ok: true, responseId: responseId as string };
}

/**
 * ¿La inscripción respondió la encuesta requerida del curso? Lo consume el gate
 * de certificados (3.2, `completion_rules.requireSurvey`). Si el curso no tiene
 * ninguna encuesta PUBLICADA, no se puede satisfacer el requisito → false.
 */
export async function hasCompletedSurvey(
  guard: TenantGuard,
  tenantId: string,
  courseId: string,
  enrollmentId: string,
): Promise<boolean> {
  const surveys = await fetchAll<{ id: string }>((offset) =>
    guard.db
      .from("surveys")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("course_id", courseId)
      .eq("status", "published")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1),
  );
  if (surveys.length === 0) return false;
  const surveyIds = surveys.map((s) => s.id);
  const { data } = await guard.db
    .from("survey_submissions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("enrollment_id", enrollmentId)
    .in("survey_id", surveyIds)
    .limit(1);
  return (data ?? []).length > 0;
}

// ---------- resultados agregados por acción ----------

export interface SurveyResultEntry {
  readonly surveyId: string;
  readonly title: string;
  readonly aggregate: SurveyAggregate;
}

export interface SurveyResultsView {
  readonly actionId: string;
  readonly courseName: string;
  readonly code: string;
  readonly surveys: readonly SurveyResultEntry[];
}

export async function getSurveyResults(
  principal: Principal,
  actionId: string,
): Promise<SurveyResultsView | null> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, RESULT_VIEWERS)) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  const { data: action } = await guard.db
    .from("actions")
    .select("id, codigo_accion, course_id, courses!inner(name)")
    .eq("tenant_id", tenantId)
    .eq("id", actionId)
    .maybeSingle();
  if (!action) return null;
  const courseName = (action as unknown as { courses: { name: string } }).courses.name;

  const surveys = await fetchAll<SurveyRow>((offset) =>
    guard.db
      .from("surveys")
      .select("id, course_id, title, intro, anonymous, status, questions")
      .eq("tenant_id", tenantId)
      .eq("course_id", action.course_id as string)
      .eq("status", "published")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1),
  );

  const responses = await fetchAll<{ survey_id: string; answers: SurveyAnswers }>((offset) =>
    guard.db
      .from("survey_responses")
      .select("survey_id, answers")
      .eq("tenant_id", tenantId)
      .eq("action_id", actionId)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1),
  );
  const byrSurvey = new Map<string, SurveyAnswers[]>();
  for (const r of responses) {
    const arr = byrSurvey.get(r.survey_id) ?? [];
    arr.push(r.answers ?? {});
    byrSurvey.set(r.survey_id, arr);
  }

  return {
    actionId,
    courseName,
    code: action.codigo_accion as string,
    surveys: surveys.map((s) => {
      const summary = toSummary(s);
      return {
        surveyId: summary.id,
        title: summary.title,
        aggregate: aggregateSurvey(summary.questions, byrSurvey.get(summary.id) ?? []),
      };
    }),
  };
}

export async function getSurveyResultsExport(
  principal: Principal,
  actionId: string,
  labels: SurveyCsvLabels,
): Promise<{ filename: string; headers: string[]; rows: string[][] } | null> {
  const view = await getSurveyResults(principal, actionId);
  if (!view) return null;
  // Todas las preguntas de las encuestas publicadas de la acción.
  const merged: SurveyAggregate = {
    total: view.surveys.reduce((acc, s) => Math.max(acc, s.aggregate.total), 0),
    questions: view.surveys.flatMap((s) => s.aggregate.questions),
  };
  const safeCode = view.code.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40);
  const { headers, rows } = surveyResultsRows(merged, labels);
  return { filename: `encuesta-${safeCode}`, headers, rows };
}
