import "server-only";

import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import {
  parseQuestionInput,
  parseQuizInput,
  type FieldError,
} from "@/modules/evaluacion/domain/quiz";

/**
 * CRUD de quizzes y su banco de preguntas (task 2.1, HU-6.1 — D-022).
 * Escrituras vía service-role bajo tenantGuard; autorizadas a
 * admin/coordinador/relator (matriz §3: el relator crea y corrige; "propio"
 * queda tenant-wide hasta la asignación relator↔curso — follow-up conocido).
 * El tutor NO crea ni edita instrumentos.
 */

const MANAGERS = ["otec_admin", "coordinator", "instructor"] as const;

export type QuizServiceError =
  | "forbidden"
  | "no_tenant"
  | "not_found"
  | "course_not_found"
  | "has_attempts"
  | "no_questions"
  | "pool_larger_than_bank";

export type QuizMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: QuizServiceError }
  | { ok: false; validation: FieldError[] };

export interface QuizRow {
  id: string;
  course_id: string;
  title: string;
  description: string;
  status: "draft" | "published";
  time_limit_minutes: number | null;
  max_attempts: number | null;
  attempt_scoring: "best" | "last" | "average";
  passing_pct: number;
  pool_size: number | null;
  shuffle_questions: boolean;
  shuffle_choices: boolean;
  review_policy: "never" | "after_submit" | "after_close";
  opens_at: string | null;
  closes_at: string | null;
  weight: number;
}

export interface QuestionListRow {
  id: string;
  kind: "multiple_choice" | "true_false" | "matching";
  prompt: string;
  points: number;
  position: number;
  body: unknown;
}

function canManage(p: Principal): boolean {
  return Boolean(p.tenantId) && authorize(p, p.tenantId!, MANAGERS);
}

function quizToRow(v: ReturnType<typeof parseQuizInput> & { ok: true }): Record<string, unknown> {
  const q = v.value;
  return {
    title: q.title,
    description: q.description,
    time_limit_minutes: q.timeLimitMinutes,
    max_attempts: q.maxAttempts,
    attempt_scoring: q.attemptScoring,
    passing_pct: q.passingPct,
    pool_size: q.poolSize,
    shuffle_questions: q.shuffleQuestions,
    shuffle_choices: q.shuffleChoices,
    review_policy: q.reviewPolicy,
    weight: q.weight,
  };
}

const QUIZ_COLUMNS =
  "id, course_id, title, description, status, time_limit_minutes, max_attempts, attempt_scoring, passing_pct, pool_size, shuffle_questions, shuffle_choices, review_policy, opens_at, closes_at, weight";

export async function listQuizzesByCourse(
  principal: Principal,
  courseId: string,
): Promise<(QuizRow & { questionCount: number })[]> {
  if (!canManage(principal)) return [];
  const guard = tenantGuard(principal.tenantId!);
  const [{ data: quizzes }, { data: questions }] = await Promise.all([
    guard.from("quizzes").select(QUIZ_COLUMNS).eq("course_id", courseId).order("created_at", { ascending: true }),
    guard.from("questions").select("quiz_id"),
  ]);
  const countByQuiz = new Map<string, number>();
  for (const q of (questions ?? []) as { quiz_id: string }[]) {
    countByQuiz.set(q.quiz_id, (countByQuiz.get(q.quiz_id) ?? 0) + 1);
  }
  return ((quizzes ?? []) as QuizRow[]).map((q) => ({
    ...q,
    questionCount: countByQuiz.get(q.id) ?? 0,
  }));
}

/** Un quiz por id (para el editor). */
export async function getQuiz(principal: Principal, quizId: string): Promise<QuizRow | null> {
  if (!canManage(principal)) return null;
  const guard = tenantGuard(principal.tenantId!);
  const { data } = await guard.from("quizzes").select(QUIZ_COLUMNS).eq("id", quizId).maybeSingle();
  return (data as QuizRow | null) ?? null;
}

export async function createQuiz(
  principal: Principal,
  courseId: string,
  raw: Record<string, unknown>,
): Promise<QuizMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };

  const parsed = parseQuizInput(raw);
  if (!parsed.ok) return { ok: false, validation: parsed.errors };

  const guard = tenantGuard(principal.tenantId);
  const { data: course } = await guard.from("courses").select("id").eq("id", courseId).maybeSingle();
  if (!course) return { ok: false, error: "course_not_found" };

  const { data, error } = await guard.db
    .from("quizzes")
    .insert(guard.withTenant({ course_id: courseId, ...quizToRow(parsed) }))
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "not_found" };
  return { ok: true, id: data.id as string };
}

export async function updateQuiz(
  principal: Principal,
  quizId: string,
  raw: Record<string, unknown>,
): Promise<QuizMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };

  const parsed = parseQuizInput(raw);
  if (!parsed.ok) return { ok: false, validation: parsed.errors };

  const guard = tenantGuard(principal.tenantId);
  const { data, error } = await guard.db
    .from("quizzes")
    .update(quizToRow(parsed))
    .eq("id", quizId)
    .eq("tenant_id", principal.tenantId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "not_found" };
  return { ok: true, id: data.id as string };
}

/** Publicar exige ≥1 pregunta y pool ≤ tamaño del banco (D-022 §S3). */
export async function publishQuiz(
  principal: Principal,
  quizId: string,
  publish: boolean,
): Promise<QuizMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };

  const guard = tenantGuard(principal.tenantId);
  const { data: quiz } = await guard
    .from("quizzes")
    .select("id, pool_size")
    .eq("id", quizId)
    .maybeSingle();
  if (!quiz) return { ok: false, error: "not_found" };

  if (publish) {
    const { count } = await guard.db
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", principal.tenantId)
      .eq("quiz_id", quizId);
    if (!count) return { ok: false, error: "no_questions" };
    if (quiz.pool_size !== null && (quiz.pool_size as number) > count) {
      return { ok: false, error: "pool_larger_than_bank" };
    }
  }

  const { error } = await guard.db
    .from("quizzes")
    .update({ status: publish ? "published" : "draft" })
    .eq("id", quizId)
    .eq("tenant_id", principal.tenantId);
  if (error) return { ok: false, error: "not_found" };
  return { ok: true, id: quizId };
}

/** Borrar solo borradores SIN intentos (los intentos son evidencia académica). */
export async function deleteQuiz(
  principal: Principal,
  quizId: string,
): Promise<QuizMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };

  const guard = tenantGuard(principal.tenantId);
  const { data: quiz } = await guard
    .from("quizzes")
    .select("id, status")
    .eq("id", quizId)
    .maybeSingle();
  if (!quiz) return { ok: false, error: "not_found" };
  if (quiz.status !== "draft") return { ok: false, error: "has_attempts" };

  const { count } = await guard.db
    .from("quiz_attempts")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", principal.tenantId)
    .eq("quiz_id", quizId);
  if (count) return { ok: false, error: "has_attempts" };

  const { error } = await guard.db
    .from("quizzes")
    .delete()
    .eq("id", quizId)
    .eq("tenant_id", principal.tenantId);
  if (error) return { ok: false, error: "not_found" };
  return { ok: true, id: quizId };
}

// ---------- banco de preguntas ----------

export async function listQuestions(
  principal: Principal,
  quizId: string,
): Promise<QuestionListRow[]> {
  if (!canManage(principal)) return [];
  const guard = tenantGuard(principal.tenantId!);
  const { data } = await guard
    .from("questions")
    .select("id, kind, prompt, points, position, body")
    .eq("quiz_id", quizId)
    .order("position", { ascending: true });
  return (data ?? []) as QuestionListRow[];
}

export async function createQuestion(
  principal: Principal,
  quizId: string,
  raw: Record<string, unknown>,
): Promise<QuizMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };

  const parsed = parseQuestionInput(raw);
  if (!parsed.ok) return { ok: false, validation: parsed.errors };

  const guard = tenantGuard(principal.tenantId);
  const { data: quiz } = await guard.from("quizzes").select("id").eq("id", quizId).maybeSingle();
  if (!quiz) return { ok: false, error: "not_found" };

  const { count } = await guard.db
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", principal.tenantId)
    .eq("quiz_id", quizId);

  const { data, error } = await guard.db
    .from("questions")
    .insert(
      guard.withTenant({
        quiz_id: quizId,
        kind: parsed.value.kind,
        prompt: parsed.value.prompt,
        points: parsed.value.points,
        body: parsed.value.body,
        position: (count ?? 0) + 1,
      }),
    )
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "not_found" };
  return { ok: true, id: data.id as string };
}

export async function updateQuestion(
  principal: Principal,
  questionId: string,
  raw: Record<string, unknown>,
): Promise<QuizMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };

  const parsed = parseQuestionInput(raw);
  if (!parsed.ok) return { ok: false, validation: parsed.errors };

  const guard = tenantGuard(principal.tenantId);
  const { data, error } = await guard.db
    .from("questions")
    .update({
      kind: parsed.value.kind,
      prompt: parsed.value.prompt,
      points: parsed.value.points,
      body: parsed.value.body,
    })
    .eq("id", questionId)
    .eq("tenant_id", principal.tenantId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "not_found" };
  return { ok: true, id: data.id as string };
}

export async function deleteQuestion(
  principal: Principal,
  questionId: string,
): Promise<QuizMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };

  const guard = tenantGuard(principal.tenantId);
  const { data, error } = await guard.db
    .from("questions")
    .delete()
    .eq("id", questionId)
    .eq("tenant_id", principal.tenantId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "not_found" };
  return { ok: true, id: questionId };
}
