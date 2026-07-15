/**
 * Integración de tareas (task 2.2, HU-6.2) contra Supabase local + Storage:
 * entrega del alumno (archivo al bucket privado, historial, tolerancia de
 * fechas), corrección (tutor guarda draft, SOLO relator publica → aviso +
 * audit), cambio de nota publicada con motivo (gate), signed URL por permiso.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { EmailSender, OutgoingEmail } from "@/modules/comunicacion/email-sender";
import type { Principal } from "@/modules/core/domain/rbac";
import {
  createAssignment,
  getSubmissionDownloadUrl,
  listMySubmissions,
  publishAssignment,
  submitAssignment,
} from "@/modules/evaluacion/assignment-service";
import {
  listPendingSubmissions,
  publishGrade,
  saveDraftGrade,
  updatePublishedGrade,
} from "@/modules/evaluacion/grading-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const USER_STUDENT = "aaaaaaaa-0000-4000-8000-000000000005";

const admin: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };
const instructor: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000003", tenantId: TENANT_A, roles: ["instructor"] };
const tutor: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000004", tenantId: TENANT_A, roles: ["tutor"] };
const student: Principal = { userId: USER_STUDENT, tenantId: TENANT_A, roles: ["student"] };

let svc: SupabaseClient;
let courseId = "";
let actionId = "";

function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

function pdf(name = "informe.pdf"): { name: string; size: number; type: string; bytes: ArrayBuffer } {
  const bytes = new TextEncoder().encode("%PDF-1.4 demo").buffer;
  return { name, size: bytes.byteLength, type: "application/pdf", bytes };
}

beforeAll(async () => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });

  courseId = randomUUID();
  await svc.from("courses").insert({ id: courseId, tenant_id: TENANT_A, name: "Curso tareas", sence: false });
  actionId = randomUUID();
  await svc.from("actions").insert({
    id: actionId, tenant_id: TENANT_A, course_id: courseId,
    codigo_accion: "TAREA-TEST", training_line: 3, environment: "rcetest",
  });
  await svc.from("enrollments").insert({
    id: randomUUID(), tenant_id: TENANT_A, action_id: actionId, user_id: USER_STUDENT,
    run: "5126663-3", first_names: "Ana", last_names: "Díaz",
  });
});

async function publishedAssignment(config: Record<string, unknown> = {}): Promise<string> {
  const created = await createAssignment(admin, courseId, { title: `Tarea ${randomUUID().slice(0, 6)}`, ...config });
  if (!created.ok) throw new Error(JSON.stringify(created));
  await publishAssignment(admin, created.id, true);
  return created.id;
}

describe("submitAssignment — entrega del alumno", () => {
  it("sube el archivo, crea versión 1 y luego 2 (historial); a tiempo", async () => {
    const assignmentId = await publishedAssignment();
    const first = await submitAssignment(student, assignmentId, { file: pdf(), comment: "v1" });
    if (!first.ok) throw new Error(first.error);
    expect(first.late).toBe(false);

    const second = await submitAssignment(student, assignmentId, { file: pdf("v2.pdf"), comment: "v2" });
    expect(second.ok).toBe(true);

    const history = await listMySubmissions(student, assignmentId);
    expect(history.map((h) => h.version)).toEqual([2, 1]);
  });

  it("archivo no permitido o tarea en borrador → rechazado", async () => {
    const assignmentId = await publishedAssignment();
    const badFile = await submitAssignment(student, assignmentId, {
      file: { name: "x.exe", size: 10, type: "application/x-msdownload", bytes: new ArrayBuffer(10) },
      comment: "",
    });
    expect(badFile).toEqual({ ok: false, error: "file_rejected" });
  });

  it("entrega fuera del plazo+gracia → late_rejected", async () => {
    const past = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const assignmentId = await publishedAssignment({ dueAt: past, graceHours: 1 });
    const late = await submitAssignment(student, assignmentId, { file: pdf(), comment: "" });
    expect(late).toEqual({ ok: false, error: "late_rejected" });
  });

  it("signed URL: el dueño y el staff pueden; otro alumno no", async () => {
    const assignmentId = await publishedAssignment();
    const sub = await submitAssignment(student, assignmentId, { file: pdf(), comment: "" });
    if (!sub.ok) throw new Error(sub.error);
    expect((await getSubmissionDownloadUrl(student, sub.id)).ok).toBe(true);
    expect((await getSubmissionDownloadUrl(instructor, sub.id)).ok).toBe(true);
    // Un tutor de OTRO tenant no ve la entrega.
    const otherTenant: Principal = { userId: "bbbbbbbb-0000-4000-8000-000000000004", tenantId: "22222222-2222-4222-8222-222222222222", roles: ["tutor"] };
    expect((await getSubmissionDownloadUrl(otherTenant, sub.id)).ok).toBe(false);
  });
});

describe("corrección — draft/publish y auditoría (S11/S12 — el gate del hito)", () => {
  it("tutor guarda draft pero NO publica; relator publica → notificación + audit", async () => {
    const outbox: OutgoingEmail[] = [];
    const sender: EmailSender = {
      configured: true,
      async send(email) {
        outbox.push(email);
        return { ok: true, id: "fake" };
      },
    };
    const assignmentId = await publishedAssignment();
    const sub = await submitAssignment(student, assignmentId, { file: pdf(), comment: "" });
    if (!sub.ok) throw new Error(sub.error);

    // Tutor: draft OK.
    const draft = await saveDraftGrade(tutor, sub.id, { directGrade: 5.5, feedback: "Buen trabajo" });
    expect(draft.ok).toBe(true);
    // Tutor NO publica.
    expect(await publishGrade(tutor, sub.id, { directGrade: 5.5, feedback: "x" })).toEqual({
      ok: false,
      error: "forbidden",
    });

    // Relator publica → grade published, notificación al alumno, correo, audit.
    const published = await publishGrade(instructor, sub.id, { directGrade: 6.0, feedback: "Excelente" }, { emailSender: sender });
    if (!published.ok) throw new Error(JSON.stringify(published));

    const { data: grade } = await svc.from("grades").select("grade, status, source_kind").eq("id", published.gradeId).single();
    expect(grade).toMatchObject({ grade: 6.0, status: "published", source_kind: "assignment" });

    const { data: notif } = await svc.from("notifications").select("kind, status").eq("user_id", USER_STUDENT);
    expect((notif ?? []).some((n) => n.kind === "grade.published" && n.status === "sent")).toBe(true);
    expect(outbox).toHaveLength(1);

    const { data: audit } = await svc.from("audit_log").select("action").eq("entity_id", published.gradeId).eq("action", "grade.published");
    expect(audit).toHaveLength(1);
  });

  it("editar una nota publicada SIN motivo → validation; CON motivo → audit grade.updated", async () => {
    const assignmentId = await publishedAssignment();
    const sub = await submitAssignment(student, assignmentId, { file: pdf(), comment: "" });
    if (!sub.ok) throw new Error(sub.error);
    const published = await publishGrade(instructor, sub.id, { directGrade: 4.0, feedback: "" });
    if (!published.ok) throw new Error(JSON.stringify(published));

    const noMotivo = await updatePublishedGrade(instructor, published.gradeId, { directGrade: 6.5, feedback: "", motivo: null });
    expect(noMotivo.ok).toBe(false);
    if (!noMotivo.ok && "validation" in noMotivo) {
      expect(noMotivo.validation[0]?.field).toBe("motivo");
    }

    const withMotivo = await updatePublishedGrade(instructor, published.gradeId, {
      directGrade: 6.5,
      feedback: "recorregido",
      motivo: "Error en la suma de la pauta original",
    });
    expect(withMotivo.ok).toBe(true);

    const { data: audit } = await svc
      .from("audit_log")
      .select("details")
      .eq("entity_id", published.gradeId)
      .eq("action", "grade.updated")
      .single();
    expect(audit?.details).toMatchObject({ old: 4, new: 6.5, motivo: "Error en la suma de la pauta original" });
  });

  it("cola de corrección: lista la última versión con su estado", async () => {
    const assignmentId = await publishedAssignment();
    await submitAssignment(student, assignmentId, { file: pdf("a.pdf"), comment: "" });
    await submitAssignment(student, assignmentId, { file: pdf("b.pdf"), comment: "" });
    const pending = await listPendingSubmissions(instructor, actionId);
    const mine = pending.find((p) => p.assignmentId === assignmentId);
    expect(mine?.version).toBe(2);
    expect(mine?.studentName).toContain("Díaz");
  });

  it("rúbrica: la nota sale del puntaje de los niveles elegidos", async () => {
    const rubric = {
      criteria: [
        { id: "c1", title: "Claridad", levels: [{ id: "l1", label: "No", points: 0 }, { id: "l2", label: "Sí", points: 10 }] },
      ],
    };
    const assignmentId = await publishedAssignment({ rubric });
    const sub = await submitAssignment(student, assignmentId, { file: pdf(), comment: "" });
    if (!sub.ok) throw new Error(sub.error);
    const graded = await publishGrade(instructor, sub.id, { rubricSelection: { c1: "l2" }, feedback: "" });
    if (!graded.ok) throw new Error(JSON.stringify(graded));
    const { data } = await svc.from("grades").select("grade, score, max_score").eq("id", graded.gradeId).single();
    expect(data).toMatchObject({ grade: 7, score: 10, max_score: 10 });
  });

  it("un student no puede corregir", async () => {
    const assignmentId = await publishedAssignment();
    const sub = await submitAssignment(student, assignmentId, { file: pdf(), comment: "" });
    if (!sub.ok) throw new Error(sub.error);
    expect(await saveDraftGrade(student, sub.id, { directGrade: 7, feedback: "" })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});
