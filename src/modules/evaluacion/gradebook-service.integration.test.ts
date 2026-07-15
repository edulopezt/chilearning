/**
 * Integración del libro de notas (task 2.3, HU-6.4 — el GATE del hito) contra
 * Supabase local: consolidación ponderada de quizzes+tareas por acción, promedio
 * parcial + marca incompleta, permisos, export CSV, e HISTORIAL de cambios de
 * nota (auditoría `grade.updated`, solo otec_admin).
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "@/modules/core/domain/rbac";
import { createAssignment, publishAssignment, submitAssignment } from "@/modules/evaluacion/assignment-service";
import { publishGrade, updatePublishedGrade } from "@/modules/evaluacion/grading-service";
import {
  getGradebook,
  getGradebookCsv,
  getGradeHistory,
  listGradebookActions,
} from "@/modules/evaluacion/gradebook-service";
import type { CsvLabels } from "@/modules/evaluacion/domain/gradebook";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const USER_STUDENT = "aaaaaaaa-0000-4000-8000-000000000005";

const admin: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };
const instructor: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000003", tenantId: TENANT_A, roles: ["instructor"] };
const student: Principal = { userId: USER_STUDENT, tenantId: TENANT_A, roles: ["student"] };
const instructorB: Principal = { userId: "bbbbbbbb-0000-4000-8000-000000000003", tenantId: TENANT_B, roles: ["instructor"] };

const LABELS: CsvLabels = {
  student: "Alumno",
  run: "RUN",
  finalGrade: "Nota final",
  status: "Estado",
  statusPassed: "Aprobado",
  statusFailed: "Reprobado",
  statusIncomplete: "Incompleta",
  statusNoGrades: "Sin notas",
};

let svc: SupabaseClient;

function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

/** Crea curso + acción + inscribe al alumno demo; devuelve los ids. */
async function freshAction(): Promise<{ courseId: string; actionId: string; enrollmentId: string }> {
  const courseId = randomUUID();
  await svc.from("courses").insert({ id: courseId, tenant_id: TENANT_A, name: "Curso notas", sence: false });
  const actionId = randomUUID();
  await svc.from("actions").insert({
    id: actionId, tenant_id: TENANT_A, course_id: courseId,
    codigo_accion: `NOTAS-${randomUUID().slice(0, 6)}`, training_line: 3, environment: "rcetest",
  });
  const enrollmentId = randomUUID();
  await svc.from("enrollments").insert({
    id: enrollmentId, tenant_id: TENANT_A, action_id: actionId, user_id: USER_STUDENT,
    run: "5126663-3", first_names: "Ana", last_names: "Díaz",
  });
  return { courseId, actionId, enrollmentId };
}

async function publishedQuiz(courseId: string, weight: number, title = "Quiz"): Promise<string> {
  const id = randomUUID();
  await svc.from("quizzes").insert({ id, tenant_id: TENANT_A, course_id: courseId, title, status: "published", weight });
  return id;
}

async function publishedAssignmentRow(courseId: string, weight: number, title = "Tarea"): Promise<string> {
  const id = randomUUID();
  await svc.from("assignments").insert({ id, tenant_id: TENANT_A, course_id: courseId, title, status: "published", weight });
  return id;
}

async function gradeQuiz(enrollmentId: string, quizId: string, grade: number): Promise<void> {
  await svc.from("grades").insert({
    tenant_id: TENANT_A, enrollment_id: enrollmentId, source_kind: "quiz", quiz_id: quizId,
    grade, status: "published", published_at: new Date().toISOString(),
  });
}

async function gradeAssignment(enrollmentId: string, assignmentId: string, grade: number): Promise<void> {
  await svc.from("grades").insert({
    tenant_id: TENANT_A, enrollment_id: enrollmentId, source_kind: "assignment", assignment_id: assignmentId,
    grade, status: "published", published_at: new Date().toISOString(),
  });
}

function pdf(): { name: string; size: number; type: string; bytes: ArrayBuffer } {
  const bytes = new TextEncoder().encode("%PDF-1.4 demo").buffer;
  return { name: "informe.pdf", size: bytes.byteLength, type: "application/pdf", bytes };
}

beforeAll(() => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
});

describe("getGradebook — consolidación ponderada (S10)", () => {
  it("promedia quizzes + tareas ponderando por peso; completo → aprobado", async () => {
    const { courseId, actionId, enrollmentId } = await freshAction();
    const quiz = await publishedQuiz(courseId, 1, "Quiz 1");
    const tarea = await publishedAssignmentRow(courseId, 3, "Tarea 1");
    await gradeQuiz(enrollmentId, quiz, 5.0);
    await gradeAssignment(enrollmentId, tarea, 7.0);

    const view = await getGradebook(instructor, actionId);
    if (!view) throw new Error("gradebook null");
    expect(view.gradebook.instruments).toHaveLength(2);
    const row = view.gradebook.rows.find((r) => r.enrollmentId === enrollmentId)!;
    expect(row.finalGrade).toBe(6.5); // (5·1 + 7·3)/4
    expect(row.incomplete).toBe(false);
    expect(row.passed).toBe(true);
    expect(row.name).toBe("Díaz, Ana");
  });

  it("un instrumento sin nota → promedio parcial + incompleta", async () => {
    const { courseId, actionId, enrollmentId } = await freshAction();
    const quiz = await publishedQuiz(courseId, 1, "Quiz 1");
    await publishedAssignmentRow(courseId, 1, "Tarea 1"); // publicada pero sin nota
    await gradeQuiz(enrollmentId, quiz, 6.0);

    const view = await getGradebook(instructor, actionId);
    const row = view!.gradebook.rows.find((r) => r.enrollmentId === enrollmentId)!;
    expect(row.finalGrade).toBe(6.0); // parcial, NO cuenta la tarea faltante como 1.0
    expect(row.incomplete).toBe(true);
    expect(row.passed).toBeNull();
  });

  it("solo cuenta instrumentos PUBLICADOS", async () => {
    const { courseId, actionId, enrollmentId } = await freshAction();
    const quiz = await publishedQuiz(courseId, 1, "Quiz 1");
    // Tarea en borrador: no debe aparecer como columna ni marcar incompleta.
    const draft = randomUUID();
    await svc.from("assignments").insert({ id: draft, tenant_id: TENANT_A, course_id: courseId, title: "Borrador", status: "draft", weight: 1 });
    await gradeQuiz(enrollmentId, quiz, 5.0);

    const view = await getGradebook(instructor, actionId);
    expect(view!.gradebook.instruments).toHaveLength(1);
    const row = view!.gradebook.rows[0]!;
    expect(row.incomplete).toBe(false);
    expect(row.finalGrade).toBe(5.0);
  });

  it("un student no ve el libro; cross-tenant → null", async () => {
    const { actionId } = await freshAction();
    expect(await getGradebook(student, actionId)).toBeNull();
    expect(await getGradebook(instructorB, actionId)).toBeNull();
  });

  it("listGradebookActions incluye la acción para el relator", async () => {
    const { actionId } = await freshAction();
    const list = await listGradebookActions(instructor);
    expect(list.some((a) => a.actionId === actionId)).toBe(true);
    expect(await listGradebookActions(student)).toEqual([]);
  });
});

describe("export CSV", () => {
  it("genera CSV con BOM, encabezados y la fila del alumno", async () => {
    const { courseId, actionId, enrollmentId } = await freshAction();
    const quiz = await publishedQuiz(courseId, 1, "Quiz 1");
    await gradeQuiz(enrollmentId, quiz, 6.0);

    const result = await getGradebookCsv(instructor, actionId, LABELS);
    if (!result) throw new Error("csv null");
    expect(result.filename).toMatch(/^notas-NOTAS-/);
    expect(result.csv.startsWith("﻿")).toBe(true);
    expect(result.csv).toContain("Díaz, Ana;5126663-3;6.0;6.0;Aprobado");
  });
});

describe("historial de cambios de nota (auditoría — el gate)", () => {
  it("registra el cambio con motivo y solo el otec_admin lo ve", async () => {
    const { courseId, actionId } = await freshAction();
    const created = await createAssignment(admin, courseId, { title: "Ensayo" });
    if (!created.ok) throw new Error(JSON.stringify(created));
    await publishAssignment(admin, created.id, true);
    const sub = await submitAssignment(student, created.id, { file: pdf(), comment: "" });
    if (!sub.ok) throw new Error(sub.error);
    const published = await publishGrade(instructor, sub.id, { directGrade: 4.0, feedback: "" });
    if (!published.ok) throw new Error(JSON.stringify(published));
    const changed = await updatePublishedGrade(instructor, published.gradeId, {
      directGrade: 6.5, feedback: "recorregido", motivo: "Se recalculó la rúbrica",
    });
    expect(changed.ok).toBe(true);

    const history = await getGradeHistory(admin, actionId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      instrument: "Ensayo",
      oldGrade: 4,
      newGrade: 6.5,
      motivo: "Se recalculó la rúbrica",
      studentName: "Díaz, Ana",
    });
    expect(history[0]!.actor).toContain("@");

    // El relator (no admin) no ve el historial (coincide con la RLS de audit_log).
    expect(await getGradeHistory(instructor, actionId)).toEqual([]);
  });
});
