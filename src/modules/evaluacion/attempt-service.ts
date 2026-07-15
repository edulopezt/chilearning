import "server-only";

import { tenantGuard, type TenantGuard } from "@/lib/tenant-guard";
import type { Principal } from "@/modules/core/domain/rbac";
import {
  scoreAttempt,
  type AnswerKey,
  type AttemptAnswers,
  type QuestionSnapshot,
} from "@/modules/evaluacion/domain/grading";
import {
  buildAttemptSnapshot,
  canReview,
  canStartAttempt,
  isAttemptExpired,
  selectQuizGrade,
  type AttemptScoringPolicy,
  type QuestionRow,
  type ReviewPolicy,
  type StartDenied,
} from "@/modules/evaluacion/domain/quiz";
import { chileanGrade } from "@/modules/evaluacion/domain/scale";

/**
 * Ciclo de vida del intento del ALUMNO (task 2.1, HU-6.1 — D-022):
 * start (snapshot congelado S3) → autosave → submit (nota inmediata S1, la
 * nota oficial va a `grades` como published según la política S2). El tiempo
 * vencido se resuelve con finalización PEREZOSA (S6): cualquier lectura o
 * submit de un intento vencido lo cierra con lo autosalvado.
 *
 * Todas las operaciones verifican que la inscripción sea DEL alumno (como
 * progress-service): jamás basta el tenant.
 */

export type AttemptError =
  | "no_tenant"
  | "not_enrolled"
  | "quiz_not_found"
  | StartDenied
  | "attempt_not_found"
  | "attempt_finished"
  | "review_not_allowed";

export interface AttemptView {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly status: "in_progress" | "submitted" | "expired";
  readonly snapshot: readonly QuestionSnapshot[];
  readonly answers: AttemptAnswers;
  readonly expiresAt: string | null;
  readonly score: number | null;
  readonly maxScore: number;
  readonly grade: number | null;
}

interface QuizConfigRow {
  id: string;
  course_id: string;
  status: string;
  time_limit_minutes: number | null;
  max_attempts: number | null;
  attempt_scoring: AttemptScoringPolicy;
  passing_pct: number;
  pool_size: number | null;
  shuffle_questions: boolean;
  shuffle_choices: boolean;
  review_policy: ReviewPolicy;
  opens_at: string | null;
  closes_at: string | null;
}

interface AttemptRow {
  id: string;
  quiz_id: string;
  enrollment_id: string;
  attempt_number: number;
  status: "in_progress" | "submitted" | "expired";
  questions_snapshot: QuestionSnapshot[];
  answer_key: AnswerKey;
  answers: AttemptAnswers;
  score: number | null;
  max_score: number;
  grade: number | null;
  expires_at: string | null;
}

export interface AttemptDeps {
  readonly now?: () => number;
  readonly rng?: () => number;
}

export interface StudentQuizSummary {
  readonly quizId: string;
  readonly title: string;
  readonly description: string;
  readonly timeLimitMinutes: number | null;
  readonly maxAttempts: number | null;
  readonly attemptsUsed: number;
  readonly officialGrade: number | null;
}

/** Quizzes PUBLICADOS del curso del alumno + su estado (para /mi-curso). */
export async function listStudentQuizzes(
  principal: Principal,
  deps?: AttemptDeps,
): Promise<StudentQuizSummary[]> {
  if (!principal.tenantId) return [];
  const guard = tenantGuard(principal.tenantId);

  // Cursos donde el alumno está inscrito (join acotado, sin listas grandes).
  const { data: enr } = await guard.db
    .from("enrollments")
    .select("id, actions!inner(course_id)")
    .eq("tenant_id", principal.tenantId)
    .eq("user_id", principal.userId);
  const rows = (enr ?? []) as unknown as { id: string; actions: { course_id: string } }[];
  const enrollmentByCourse = new Map<string, string>();
  for (const r of rows) enrollmentByCourse.set(r.actions.course_id, r.id);
  if (enrollmentByCourse.size === 0) return [];

  interface StudentQuizConfigRow extends QuizConfigRow {
    title: string;
    description: string;
  }
  const { data: quizzes } = await guard.db
    .from("quizzes")
    .select("id, course_id, title, description, time_limit_minutes, max_attempts, attempt_scoring")
    .eq("tenant_id", principal.tenantId)
    .eq("status", "published")
    .in("course_id", [...enrollmentByCourse.keys()])
    .order("created_at", { ascending: true });

  const now = clockOf(deps)();
  const out: StudentQuizSummary[] = [];
  for (const q of (quizzes ?? []) as unknown as StudentQuizConfigRow[]) {
    const enrollmentId = enrollmentByCourse.get(q.course_id as string);
    if (!enrollmentId) continue;
    await finalizeExpiredAttempts(guard, q.id, enrollmentId, q, now);
    const { data: attempts } = await guard.db
      .from("quiz_attempts")
      .select("grade, status")
      .eq("tenant_id", principal.tenantId)
      .eq("quiz_id", q.id)
      .eq("enrollment_id", enrollmentId);
    const finished = ((attempts ?? []) as { grade: number | null; status: string }[]).filter(
      (a) => a.status !== "in_progress",
    );
    out.push({
      quizId: q.id,
      title: (q as { title: string }).title,
      description: (q as { description: string }).description,
      timeLimitMinutes: q.time_limit_minutes,
      maxAttempts: q.max_attempts,
      attemptsUsed: finished.length,
      officialGrade: selectQuizGrade(
        finished.map((a) => a.grade).filter((g: number | null): g is number => g !== null),
        q.attempt_scoring,
      ),
    });
  }
  return out;
}

function clockOf(deps?: AttemptDeps): () => number {
  return deps?.now ?? (() => Date.now());
}

/** Inscripción del alumno cuya acción pertenece al curso del quiz (join acotado). */
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

async function loadQuiz(guard: TenantGuard, quizId: string): Promise<QuizConfigRow | null> {
  const { data } = await guard
    .from("quizzes")
    .select(
      "id, course_id, status, time_limit_minutes, max_attempts, attempt_scoring, passing_pct, pool_size, shuffle_questions, shuffle_choices, review_policy, opens_at, closes_at",
    )
    .eq("id", quizId)
    .maybeSingle();
  return (data as QuizConfigRow | null) ?? null;
}

/** Vista del alumno: intentos propios + puertas de inicio. */
export async function getStudentQuizState(
  principal: Principal,
  quizId: string,
  deps?: AttemptDeps,
): Promise<
  | {
      ok: true;
      quiz: Pick<
        QuizConfigRow,
        "id" | "time_limit_minutes" | "max_attempts" | "attempt_scoring" | "review_policy"
      >;
      attempts: AttemptView[];
      canStart: { ok: true } | { ok: false; reason: StartDenied };
      officialGrade: number | null;
    }
  | { ok: false; error: AttemptError }
> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  const guard = tenantGuard(principal.tenantId);

  const quiz = await loadQuiz(guard, quizId);
  if (!quiz) return { ok: false, error: "quiz_not_found" };
  const enrollmentId = await studentEnrollment(guard, principal.userId, quiz.course_id);
  if (!enrollmentId) return { ok: false, error: "not_enrolled" };

  const now = clockOf(deps)();
  await finalizeExpiredAttempts(guard, quizId, enrollmentId, quiz, now);

  const { data: attemptsData } = await guard.db
    .from("quiz_attempts")
    .select(
      "id, quiz_id, enrollment_id, attempt_number, status, questions_snapshot, answer_key, answers, score, max_score, grade, expires_at",
    )
    .eq("tenant_id", principal.tenantId)
    .eq("quiz_id", quizId)
    .eq("enrollment_id", enrollmentId)
    .order("attempt_number", { ascending: true });
  const attempts = (attemptsData ?? []) as AttemptRow[];

  const { count: questionCount } = await guard.db
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", principal.tenantId)
    .eq("quiz_id", quizId);

  const gate = canStartAttempt({
    status: quiz.status,
    questionCount: questionCount ?? 0,
    maxAttempts: quiz.max_attempts,
    attemptsUsed: attempts.filter((a) => a.status !== "in_progress").length,
    opensAt: quiz.opens_at ? Date.parse(quiz.opens_at) : null,
    closesAt: quiz.closes_at ? Date.parse(quiz.closes_at) : null,
    hasOpenAttempt: attempts.some((a) => a.status === "in_progress"),
    now,
  });

  const finishedGrades = attempts
    .filter((a) => a.status !== "in_progress" && a.grade !== null)
    .map((a) => a.grade as number);

  return {
    ok: true,
    quiz: {
      id: quiz.id,
      time_limit_minutes: quiz.time_limit_minutes,
      max_attempts: quiz.max_attempts,
      attempt_scoring: quiz.attempt_scoring,
      review_policy: quiz.review_policy,
    },
    attempts: attempts.map(toView),
    canStart: gate,
    officialGrade: selectQuizGrade(finishedGrades, quiz.attempt_scoring),
  };
}

function toView(a: AttemptRow): AttemptView {
  return {
    attemptId: a.id,
    attemptNumber: a.attempt_number,
    status: a.status,
    snapshot: a.questions_snapshot,
    answers: a.answers,
    expiresAt: a.expires_at,
    score: a.score,
    maxScore: a.max_score,
    grade: a.grade,
  };
}

/** Inicia un intento: congela snapshot + pauta (S3) y fija el deadline (S6). */
export async function startAttempt(
  principal: Principal,
  quizId: string,
  deps?: AttemptDeps,
): Promise<{ ok: true; attempt: AttemptView } | { ok: false; error: AttemptError }> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  const guard = tenantGuard(principal.tenantId);

  const quiz = await loadQuiz(guard, quizId);
  if (!quiz) return { ok: false, error: "quiz_not_found" };
  const enrollmentId = await studentEnrollment(guard, principal.userId, quiz.course_id);
  if (!enrollmentId) return { ok: false, error: "not_enrolled" };

  const now = clockOf(deps)();
  await finalizeExpiredAttempts(guard, quizId, enrollmentId, quiz, now);

  const { data: prior } = await guard.db
    .from("quiz_attempts")
    .select("attempt_number, status")
    .eq("tenant_id", principal.tenantId)
    .eq("quiz_id", quizId)
    .eq("enrollment_id", enrollmentId);
  const priorRows = (prior ?? []) as { attempt_number: number; status: string }[];

  const { data: questionsData } = await guard.db
    .from("questions")
    .select("id, kind, prompt, points, body")
    .eq("tenant_id", principal.tenantId)
    .eq("quiz_id", quizId)
    .order("position", { ascending: true });
  const bank = (questionsData ?? []) as QuestionRow[];

  const gate = canStartAttempt({
    status: quiz.status,
    questionCount: bank.length,
    maxAttempts: quiz.max_attempts,
    attemptsUsed: priorRows.filter((a) => a.status !== "in_progress").length,
    opensAt: quiz.opens_at ? Date.parse(quiz.opens_at) : null,
    closesAt: quiz.closes_at ? Date.parse(quiz.closes_at) : null,
    hasOpenAttempt: priorRows.some((a) => a.status === "in_progress"),
    now,
  });
  if (!gate.ok) return { ok: false, error: gate.reason };

  const rng = deps?.rng ?? Math.random;
  const built = buildAttemptSnapshot(
    bank,
    {
      poolSize: quiz.pool_size,
      shuffleQuestions: quiz.shuffle_questions,
      shuffleChoices: quiz.shuffle_choices,
    },
    rng,
  );
  if (built.snapshot.length === 0) return { ok: false, error: "no_questions" };

  const attemptNumber = Math.max(0, ...priorRows.map((a) => a.attempt_number)) + 1;
  const expiresAt =
    quiz.time_limit_minutes !== null
      ? new Date(now + quiz.time_limit_minutes * 60_000).toISOString()
      : null;

  const { data, error } = await guard.db
    .from("quiz_attempts")
    .insert(
      guard.withTenant({
        quiz_id: quizId,
        enrollment_id: enrollmentId,
        attempt_number: attemptNumber,
        questions_snapshot: built.snapshot,
        answer_key: built.answerKey,
        max_score: built.maxScore,
        expires_at: expiresAt,
      }),
    )
    .select(
      "id, quiz_id, enrollment_id, attempt_number, status, questions_snapshot, answer_key, answers, score, max_score, grade, expires_at",
    )
    .single();
  if (error || !data) {
    // Carrera con otro start del mismo alumno: el índice one_open la corta.
    return { ok: false, error: "already_open" };
  }
  return { ok: true, attempt: toView(data as AttemptRow) };
}

/** Autosave de respuestas (solo intentos propios en curso y no vencidos). */
export async function saveAnswers(
  principal: Principal,
  attemptId: string,
  answers: AttemptAnswers,
  deps?: AttemptDeps,
): Promise<{ ok: true } | { ok: false; error: AttemptError }> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  const guard = tenantGuard(principal.tenantId);

  const attempt = await loadOwnAttempt(guard, principal.userId, attemptId);
  if (!attempt) return { ok: false, error: "attempt_not_found" };
  if (attempt.status !== "in_progress") return { ok: false, error: "attempt_finished" };

  const now = clockOf(deps)();
  if (isAttemptExpired(attempt.expires_at ? Date.parse(attempt.expires_at) : null, now)) {
    await finalizeAttempt(guard, attempt, "expired", now);
    return { ok: false, error: "attempt_finished" };
  }

  const { error } = await guard.db
    .from("quiz_attempts")
    .update({ answers })
    .eq("id", attemptId)
    .eq("tenant_id", principal.tenantId)
    .eq("status", "in_progress");
  if (error) return { ok: false, error: "attempt_finished" };
  return { ok: true };
}

/** Envía el intento: corrige, calcula nota (S1) y publica en `grades` (S2). */
export async function submitAttempt(
  principal: Principal,
  attemptId: string,
  answers: AttemptAnswers | null,
  deps?: AttemptDeps,
): Promise<{ ok: true; attempt: AttemptView } | { ok: false; error: AttemptError }> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  const guard = tenantGuard(principal.tenantId);

  const attempt = await loadOwnAttempt(guard, principal.userId, attemptId);
  if (!attempt) return { ok: false, error: "attempt_not_found" };
  if (attempt.status !== "in_progress") return { ok: false, error: "attempt_finished" };

  const now = clockOf(deps)();
  const expired = isAttemptExpired(
    attempt.expires_at ? Date.parse(attempt.expires_at) : null,
    now,
  );
  // Vencido: se corrige con lo AUTOSALVADO (S6); lo que venga en el submit
  // tardío se ignora (el deadline ya pasó).
  const effectiveAnswers = expired ? attempt.answers : (answers ?? attempt.answers);
  const finished = await finalizeAttempt(
    guard,
    { ...attempt, answers: effectiveAnswers },
    expired ? "expired" : "submitted",
    now,
  );
  if (!finished) return { ok: false, error: "attempt_finished" };
  return { ok: true, attempt: toView(finished) };
}

/** Revisión del intento (S7): respuestas + pauta SOLO si la política lo permite. */
export async function getAttemptReview(
  principal: Principal,
  attemptId: string,
  deps?: AttemptDeps,
): Promise<
  | { ok: true; attempt: AttemptView; answerKey: AnswerKey }
  | { ok: false; error: AttemptError }
> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  const guard = tenantGuard(principal.tenantId);

  const attempt = await loadOwnAttempt(guard, principal.userId, attemptId);
  if (!attempt) return { ok: false, error: "attempt_not_found" };

  const quiz = await loadQuiz(guard, attempt.quiz_id);
  if (!quiz) return { ok: false, error: "quiz_not_found" };

  const allowed = canReview({
    policy: quiz.review_policy,
    closesAt: quiz.closes_at ? Date.parse(quiz.closes_at) : null,
    attemptStatus: attempt.status,
    now: clockOf(deps)(),
  });
  if (!allowed) return { ok: false, error: "review_not_allowed" };
  return { ok: true, attempt: toView(attempt), answerKey: attempt.answer_key };
}

// ---------- internos ----------

async function loadOwnAttempt(
  guard: TenantGuard,
  userId: string,
  attemptId: string,
): Promise<AttemptRow | null> {
  const { data } = await guard.db
    .from("quiz_attempts")
    .select(
      "id, quiz_id, enrollment_id, attempt_number, status, questions_snapshot, answer_key, answers, score, max_score, grade, expires_at, enrollments!inner(user_id)",
    )
    .eq("tenant_id", guard.tenantId)
    .eq("id", attemptId)
    .eq("enrollments.user_id", userId)
    .maybeSingle();
  return (data as AttemptRow | null) ?? null;
}

/** Finalización perezosa (S6): cierra los intentos vencidos del alumno. */
async function finalizeExpiredAttempts(
  guard: TenantGuard,
  quizId: string,
  enrollmentId: string,
  quiz: QuizConfigRow,
  now: number,
): Promise<void> {
  const { data } = await guard.db
    .from("quiz_attempts")
    .select(
      "id, quiz_id, enrollment_id, attempt_number, status, questions_snapshot, answer_key, answers, score, max_score, grade, expires_at",
    )
    .eq("tenant_id", guard.tenantId)
    .eq("quiz_id", quizId)
    .eq("enrollment_id", enrollmentId)
    .eq("status", "in_progress");
  for (const row of (data ?? []) as AttemptRow[]) {
    if (isAttemptExpired(row.expires_at ? Date.parse(row.expires_at) : null, now)) {
      await finalizeAttempt(guard, row, "expired", now);
    }
  }
}

/** Corrige, persiste el intento terminado y actualiza la nota oficial. */
async function finalizeAttempt(
  guard: TenantGuard,
  attempt: AttemptRow,
  finalStatus: "submitted" | "expired",
  now: number,
): Promise<AttemptRow | null> {
  const quiz = await loadQuiz(guard, attempt.quiz_id);
  if (!quiz) return null;

  const result = scoreAttempt(attempt.questions_snapshot, attempt.answer_key, attempt.answers);
  const grade = chileanGrade(result.score, result.maxScore || attempt.max_score, quiz.passing_pct);

  // El trigger de inmutabilidad permite UPDATE solo mientras old.status es
  // in_progress; el filtro por status hace de compare-and-set ante carreras.
  const { data, error } = await guard.db
    .from("quiz_attempts")
    .update({
      status: finalStatus,
      answers: attempt.answers,
      score: result.score,
      grade,
      submitted_at: new Date(now).toISOString(),
    })
    .eq("id", attempt.id)
    .eq("tenant_id", guard.tenantId)
    .eq("status", "in_progress")
    .select(
      "id, quiz_id, enrollment_id, attempt_number, status, questions_snapshot, answer_key, answers, score, max_score, grade, expires_at",
    )
    .maybeSingle();
  if (error || !data) return null;

  await upsertOfficialGrade(guard, quiz, attempt.enrollment_id);
  return data as AttemptRow;
}

/** Nota oficial del quiz en `grades` (published, S2): upsert por instrumento. */
async function upsertOfficialGrade(
  guard: TenantGuard,
  quiz: QuizConfigRow,
  enrollmentId: string,
): Promise<void> {
  const { data } = await guard.db
    .from("quiz_attempts")
    .select("grade, attempt_number, status")
    .eq("tenant_id", guard.tenantId)
    .eq("quiz_id", quiz.id)
    .eq("enrollment_id", enrollmentId)
    .neq("status", "in_progress")
    .order("attempt_number", { ascending: true });
  const grades = ((data ?? []) as { grade: number | null }[])
    .map((a) => a.grade)
    .filter((g): g is number => g !== null);
  const official = selectQuizGrade(grades, quiz.attempt_scoring);
  if (official === null) return;

  const { data: existing } = await guard.db
    .from("grades")
    .select("id")
    .eq("tenant_id", guard.tenantId)
    .eq("enrollment_id", enrollmentId)
    .eq("quiz_id", quiz.id)
    .maybeSingle();

  const now = new Date().toISOString();
  if (existing) {
    const { error } = await guard.db
      .from("grades")
      .update({ grade: official, status: "published", published_at: now })
      .eq("id", existing.id as string)
      .eq("tenant_id", guard.tenantId);
    if (error) console.error("[quiz] fallo actualizando nota oficial", { message: error.message });
    return;
  }
  const { error } = await guard.db.from("grades").insert(
    guard.withTenant({
      enrollment_id: enrollmentId,
      source_kind: "quiz",
      quiz_id: quiz.id,
      grade: official,
      status: "published",
      published_at: now,
      graded_by: null, // autocorregido
    }),
  );
  if (error) console.error("[quiz] fallo insertando nota oficial", { message: error.message });
}
