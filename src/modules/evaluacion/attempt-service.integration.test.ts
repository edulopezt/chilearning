/**
 * Integración de quizzes (task 2.1, HU-6.1 — D-022) contra Supabase local:
 * flujo completo del intento (start → autosave → submit → nota inmediata →
 * `grades` published), políticas de intentos (best), concurrencia (one_open),
 * expiración perezosa con lo autosalvado, inmutabilidad post-envío y permisos.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "@/modules/core/domain/rbac";
import {
  getAttemptReview,
  getStudentQuizState,
  saveAnswers,
  startAttempt,
  submitAttempt,
} from "@/modules/evaluacion/attempt-service";
import {
  createQuestion,
  createQuiz,
  deleteQuiz,
  publishQuiz,
} from "@/modules/evaluacion/quiz-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const USER_STUDENT = "aaaaaaaa-0000-4000-8000-000000000005";

const admin: Principal = {
  userId: "aaaaaaaa-0000-4000-8000-000000000001",
  tenantId: TENANT_A,
  roles: ["otec_admin"],
};
const tutor: Principal = {
  userId: "aaaaaaaa-0000-4000-8000-000000000004",
  tenantId: TENANT_A,
  roles: ["tutor"],
};
const student: Principal = { userId: USER_STUDENT, tenantId: TENANT_A, roles: ["student"] };

let svc: SupabaseClient;
let courseId = "";

/** RNG determinista para snapshots reproducibles. */
function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => {
    const m = out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"));
    if (!m?.[1]) throw new Error(`falta ${k}`);
    return m[1];
  };
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

/** Quiz publicado con 1 pregunta V/F (2 pts). Devuelve el quizId. */
async function publishedQuiz(config: Record<string, unknown> = {}): Promise<string> {
  const created = await createQuiz(admin, courseId, { title: `Quiz ${randomUUID().slice(0, 6)}`, ...config });
  if (!created.ok) throw new Error(`createQuiz: ${JSON.stringify(created)}`);
  const q = await createQuestion(admin, created.id, {
    kind: "true_false",
    prompt: "¿La respuesta es verdadero?",
    correct: true,
    points: 2,
  });
  if (!q.ok) throw new Error(`createQuestion: ${JSON.stringify(q)}`);
  const pub = await publishQuiz(admin, created.id, true);
  if (!pub.ok) throw new Error(`publishQuiz: ${JSON.stringify(pub)}`);
  return created.id;
}

beforeAll(async () => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });

  // Curso PROPIO del suite (no el demo) con acción + inscripción del alumno.
  courseId = randomUUID();
  await svc.from("courses").insert({
    id: courseId,
    tenant_id: TENANT_A,
    name: "Curso quizzes",
    sence: false,
  });
  const actionId = randomUUID();
  await svc.from("actions").insert({
    id: actionId,
    tenant_id: TENANT_A,
    course_id: courseId,
    codigo_accion: "QUIZ-TEST",
    training_line: 3,
    environment: "rcetest",
  });
  const { error } = await svc.from("enrollments").insert({
    id: randomUUID(),
    tenant_id: TENANT_A,
    action_id: actionId,
    user_id: USER_STUDENT,
    run: "5126663-3",
  });
  if (error) throw new Error(`seed enrollment: ${error.message}`);
});

describe("quiz-service — permisos y publicación", () => {
  it("student y tutor NO crean quizzes (deny-by-default)", async () => {
    expect(await createQuiz(student, courseId, { title: "X" })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await createQuiz(tutor, courseId, { title: "X" })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("publicar exige preguntas y pool ≤ banco", async () => {
    const created = await createQuiz(admin, courseId, { title: "Sin preguntas" });
    if (!created.ok) throw new Error("createQuiz falló");
    expect(await publishQuiz(admin, created.id, true)).toEqual({
      ok: false,
      error: "no_questions",
    });

    await createQuestion(admin, created.id, { kind: "true_false", prompt: "¿?", correct: true });
    const updated = await createQuiz(admin, courseId, { title: "tmp" }); // no-op para tipos
    void updated;
    const tooBig = await createQuiz(admin, courseId, { title: "Pool grande", poolSize: 5 });
    if (!tooBig.ok) throw new Error("createQuiz pool falló");
    await createQuestion(admin, tooBig.id, { kind: "true_false", prompt: "¿?", correct: true });
    expect(await publishQuiz(admin, tooBig.id, true)).toEqual({
      ok: false,
      error: "pool_larger_than_bank",
    });

    expect((await publishQuiz(admin, created.id, true)).ok).toBe(true);
    // Publicado ya no se borra (evidencia académica).
    expect(await deleteQuiz(admin, created.id)).toEqual({ ok: false, error: "has_attempts" });
  });
});

describe("attempt-service — flujo completo del alumno", () => {
  it("start → autosave → submit → nota inmediata + grades published (S1/S2)", async () => {
    const quizId = await publishedQuiz();

    const started = await startAttempt(student, quizId, { rng: seededRng(1) });
    if (!started.ok) throw new Error(`start: ${started.error}`);
    expect(started.attempt.status).toBe("in_progress");
    const questionId = started.attempt.snapshot[0]!.id;
    // El snapshot que viaja al alumno JAMÁS trae la pauta.
    expect(JSON.stringify(started.attempt.snapshot)).not.toContain("correct");

    expect(
      await saveAnswers(student, started.attempt.attemptId, { [questionId]: true }),
    ).toEqual({ ok: true });

    const submitted = await submitAttempt(student, started.attempt.attemptId, {
      [questionId]: true,
    });
    if (!submitted.ok) throw new Error(`submit: ${submitted.error}`);
    expect(submitted.attempt.status).toBe("submitted");
    expect(submitted.attempt.score).toBe(2);
    expect(submitted.attempt.grade).toBe(7.0); // 100% con exigencia 60

    // Nota oficial en grades, published, autocorregida.
    const { data: grade } = await svc
      .from("grades")
      .select("grade, status, graded_by, source_kind")
      .eq("quiz_id", quizId)
      .single();
    expect(grade).toMatchObject({
      grade: 7.0,
      status: "published",
      graded_by: null,
      source_kind: "quiz",
    });

    // Inmutable post-envío: ni el autosave ni un segundo submit pasan.
    expect(await saveAnswers(student, submitted.attempt.attemptId, {})).toEqual({
      ok: false,
      error: "attempt_finished",
    });
  });

  it("política best con 2 intentos: la nota oficial es la MEJOR (S2)", async () => {
    const quizId = await publishedQuiz({ maxAttempts: 2, attemptScoring: "best" });

    const first = await startAttempt(student, quizId, { rng: seededRng(2) });
    if (!first.ok) throw new Error(first.error);
    const q1 = first.attempt.snapshot[0]!.id;
    await submitAttempt(student, first.attempt.attemptId, { [q1]: false }); // malo → 1.0

    const second = await startAttempt(student, quizId, { rng: seededRng(3) });
    if (!second.ok) throw new Error(second.error);
    const q2 = second.attempt.snapshot[0]!.id;
    await submitAttempt(student, second.attempt.attemptId, { [q2]: true }); // bueno → 7.0

    const state = await getStudentQuizState(student, quizId);
    if (!state.ok) throw new Error(state.error);
    expect(state.officialGrade).toBe(7.0);
    expect(state.canStart).toEqual({ ok: false, reason: "no_attempts_left" });

    const { data: grade } = await svc.from("grades").select("grade").eq("quiz_id", quizId).single();
    expect(grade?.grade).toBe(7.0);
  });

  it("concurrencia: un segundo start con intento abierto → already_open (índice one_open)", async () => {
    const quizId = await publishedQuiz({ maxAttempts: 5 });
    const first = await startAttempt(student, quizId);
    expect(first.ok).toBe(true);
    const second = await startAttempt(student, quizId);
    expect(second).toEqual({ ok: false, error: "already_open" });
  });

  it("expiración perezosa (S6): vencido se corrige con lo AUTOSALVADO", async () => {
    const quizId = await publishedQuiz({ timeLimitMinutes: 1 });
    const started = await startAttempt(student, quizId, { rng: seededRng(4) });
    if (!started.ok) throw new Error(started.error);
    const q = started.attempt.snapshot[0]!.id;
    await saveAnswers(student, started.attempt.attemptId, { [q]: true });

    // 5 minutos después (reloj inyectado): el submit tardío NO puede cambiar
    // las respuestas; se corrige lo autosalvado y queda `expired`.
    const late = await submitAttempt(
      student,
      started.attempt.attemptId,
      { [q]: false },
      { now: () => Date.now() + 5 * 60_000 },
    );
    if (!late.ok) throw new Error(late.error);
    expect(late.attempt.status).toBe("expired");
    expect(late.attempt.score).toBe(2); // lo autosalvado (true), no el submit tardío
  });

  it("revisión según política (S7): after_submit permite; never bloquea", async () => {
    const open = await publishedQuiz({ reviewPolicy: "after_submit" });
    const s1 = await startAttempt(student, open, { rng: seededRng(5) });
    if (!s1.ok) throw new Error(s1.error);
    await submitAttempt(student, s1.attempt.attemptId, {});
    const review = await getAttemptReview(student, s1.attempt.attemptId);
    expect(review.ok).toBe(true);
    if (review.ok) {
      expect(Object.keys(review.answerKey).length).toBeGreaterThan(0);
    }

    const closed = await publishedQuiz({ reviewPolicy: "never" });
    const s2 = await startAttempt(student, closed, { rng: seededRng(6) });
    if (!s2.ok) throw new Error(s2.error);
    await submitAttempt(student, s2.attempt.attemptId, {});
    expect(await getAttemptReview(student, s2.attempt.attemptId)).toEqual({
      ok: false,
      error: "review_not_allowed",
    });
  });

  it("quien no está inscrito en el curso no puede rendir", async () => {
    const quizId = await publishedQuiz();
    expect(await startAttempt(tutor, quizId)).toEqual({ ok: false, error: "not_enrolled" });
  });
});
