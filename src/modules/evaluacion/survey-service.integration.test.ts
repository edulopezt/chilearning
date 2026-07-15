/**
 * Integración de la encuesta de satisfacción (task 3.1, HU-6.3) contra Supabase
 * local: CRUD de plantilla, envío atómico del alumno (anti-duplicado por RPC),
 * agregados por acción, y el helper `hasCompletedSurvey` del gate de 3.2.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { tenantGuard } from "@/lib/tenant-guard";
import type { Principal } from "@/modules/core/domain/rbac";
import {
  createSurvey,
  getSurveyResults,
  hasCompletedSurvey,
  publishSurvey,
  submitSurvey,
} from "@/modules/evaluacion/survey-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const USER_STUDENT = "aaaaaaaa-0000-4000-8000-000000000005";

const admin: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };
const student: Principal = { userId: USER_STUDENT, tenantId: TENANT_A, roles: ["student"] };
const otherStudent: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000006", tenantId: TENANT_A, roles: ["student"] };

let svc: SupabaseClient;

function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

async function freshAction(): Promise<{ courseId: string; actionId: string; enrollmentId: string }> {
  const courseId = randomUUID();
  await svc.from("courses").insert({ id: courseId, tenant_id: TENANT_A, name: "Curso encuesta", sence: false });
  const actionId = randomUUID();
  await svc.from("actions").insert({
    id: actionId, tenant_id: TENANT_A, course_id: courseId,
    codigo_accion: `ENC-${randomUUID().slice(0, 6)}`, training_line: 3, environment: "rcetest",
  });
  const enrollmentId = randomUUID();
  await svc.from("enrollments").insert({
    id: enrollmentId, tenant_id: TENANT_A, action_id: actionId, user_id: USER_STUDENT,
    run: "5126663-3", first_names: "Ana", last_names: "Díaz",
  });
  return { courseId, actionId, enrollmentId };
}

const QUESTIONS = [
  { id: "q1", type: "scale", label: "Satisfacción", required: true, scaleMax: 5 },
  { id: "q2", type: "single", label: "¿Recomiendas?", required: true, options: [{ id: "si", text: "Sí" }, { id: "no", text: "No" }] },
  { id: "q3", type: "text", label: "Comentario", required: false },
];

beforeAll(() => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
});

describe("submitSurvey — envío atómico + anti-duplicado", () => {
  it("el alumno responde una encuesta publicada; el segundo envío es already_submitted", async () => {
    const { courseId } = await freshAction();
    const created = await createSurvey(admin, courseId, { title: "Satisfacción", anonymous: true, questions: QUESTIONS });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await publishSurvey(admin, created.id, true);

    const first = await submitSurvey(student, created.id, { q1: 5, q2: "si", q3: "Excelente" });
    expect(first.ok).toBe(true);

    const second = await submitSurvey(student, created.id, { q1: 3, q2: "no" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("already_submitted");
  });

  it("no puede responder una encuesta en borrador", async () => {
    const { courseId } = await freshAction();
    const created = await createSurvey(admin, courseId, { title: "Draft", questions: QUESTIONS });
    if (!created.ok) return;
    const res = await submitSurvey(student, created.id, { q1: 4, q2: "si" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("not_published");
  });

  it("rechaza respuestas inválidas (obligatoria faltante)", async () => {
    const { courseId } = await freshAction();
    const created = await createSurvey(admin, courseId, { title: "Val", questions: QUESTIONS });
    if (!created.ok) return;
    await publishSurvey(admin, created.id, true);
    const res = await submitSurvey(student, created.id, { q3: "solo comentario" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid");
  });

  it("un usuario sin inscripción en el curso → not_enrolled", async () => {
    const { courseId } = await freshAction();
    const created = await createSurvey(admin, courseId, { title: "NoEnr", questions: QUESTIONS });
    if (!created.ok) return;
    await publishSurvey(admin, created.id, true);
    const res = await submitSurvey(otherStudent, created.id, { q1: 5, q2: "si" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("not_enrolled");
  });
});

describe("anonimato en reposo", () => {
  it("una respuesta anónima se guarda con enrollment_id NULL", async () => {
    const { courseId, actionId } = await freshAction();
    const created = await createSurvey(admin, courseId, { title: "Anon", anonymous: true, questions: QUESTIONS });
    if (!created.ok) return;
    await publishSurvey(admin, created.id, true);
    await submitSurvey(student, created.id, { q1: 5, q2: "si" });

    const { data } = await svc
      .from("survey_responses")
      .select("enrollment_id, action_id")
      .eq("survey_id", created.id);
    expect((data ?? []).length).toBe(1);
    expect((data ?? [])[0]!.enrollment_id).toBeNull();
    expect((data ?? [])[0]!.action_id).toBe(actionId);
  });

  it("una respuesta nominada conserva enrollment_id", async () => {
    const { courseId, enrollmentId } = await freshAction();
    const created = await createSurvey(admin, courseId, { title: "Nominada", anonymous: false, questions: QUESTIONS });
    if (!created.ok) return;
    await publishSurvey(admin, created.id, true);
    await submitSurvey(student, created.id, { q1: 4, q2: "no" });

    const { data } = await svc.from("survey_responses").select("enrollment_id").eq("survey_id", created.id);
    expect((data ?? [])[0]!.enrollment_id).toBe(enrollmentId);
  });
});

describe("getSurveyResults + hasCompletedSurvey", () => {
  it("agrega las respuestas por acción", async () => {
    const { courseId, actionId } = await freshAction();
    const created = await createSurvey(admin, courseId, { title: "Resultados", anonymous: true, questions: QUESTIONS });
    if (!created.ok) return;
    await publishSurvey(admin, created.id, true);
    await submitSurvey(student, created.id, { q1: 5, q2: "si", q3: "Muy bueno" });

    const results = await getSurveyResults(admin, actionId);
    expect(results).not.toBeNull();
    const entry = results!.surveys.find((s) => s.surveyId === created.id);
    expect(entry).toBeDefined();
    expect(entry!.aggregate.total).toBe(1);
    const scale = entry!.aggregate.questions.find((q) => q.questionId === "q1");
    if (scale?.type === "scale") expect(scale.average).toBe(5);

    // El alumno no ve resultados.
    expect(await getSurveyResults(student, actionId)).toBeNull();
  });

  it("hasCompletedSurvey refleja la participación (gate de 3.2)", async () => {
    const { courseId, enrollmentId } = await freshAction();
    const guard = tenantGuard(TENANT_A);
    // Sin encuesta publicada → no se puede satisfacer.
    expect(await hasCompletedSurvey(guard, TENANT_A, courseId, enrollmentId)).toBe(false);

    const created = await createSurvey(admin, courseId, { title: "Gate", anonymous: true, questions: QUESTIONS });
    if (!created.ok) return;
    await publishSurvey(admin, created.id, true);
    // Publicada pero sin responder aún.
    expect(await hasCompletedSurvey(guard, TENANT_A, courseId, enrollmentId)).toBe(false);

    await submitSurvey(student, created.id, { q1: 5, q2: "si" });
    expect(await hasCompletedSurvey(guard, TENANT_A, courseId, enrollmentId)).toBe(true);
  });
});
