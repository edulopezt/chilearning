/**
 * Integración de clonado y re-ejecución (task 2.8, HU-3.6) contra Supabase local:
 * clone_course copia contenido + instrumentos SIN acciones/inscripciones (curso
 * en borrador); re-ejecución crea una acción borrador con `cloned_from`; el gate
 * de activación exige fechas y código nuevo; no se inscribe en acciones draft.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "@/modules/core/domain/rbac";
import { cloneCourse } from "@/modules/academico/course-service";
import { reexecuteAction, scheduleAndActivate } from "@/modules/academico/action-service";
import { importEnrollmentsFromCsv } from "@/modules/academico/enrollment-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const admin: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };
const adminB: Principal = { userId: "bbbbbbbb-0000-4000-8000-000000000001", tenantId: TENANT_B, roles: ["otec_admin"] };

let svc: SupabaseClient;
let apiUrl = "";
let anonKey = "";
let jwtSecret = "";

function env(): { apiUrl: string; serviceRoleKey: string; anonKey: string; jwtSecret: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return {
    apiUrl: get("API_URL"),
    serviceRoleKey: get("SERVICE_ROLE_KEY"),
    anonKey: get("ANON_KEY"),
    jwtSecret: get("JWT_SECRET"),
  };
}

/** Crea un curso con 2 lecciones + 1 quiz(+pregunta) + 1 tarea. Devuelve el id. */
async function seedCourseWithContent(): Promise<string> {
  const courseId = randomUUID();
  // `validity_months = 24`: la clonación es el camino canónico para versionar un
  // curso NORMATIVO, y la vigencia debe sobrevivir a la copia (4-ojos MED).
  await svc.from("courses").insert({ id: courseId, tenant_id: TENANT_A, name: "Curso origen", sence: false, status: "published", validity_months: 24 });
  await svc.from("lessons").insert([
    { tenant_id: TENANT_A, course_id: courseId, title: "L1", kind: "text", content: "a", position: 1, status: "published" },
    { tenant_id: TENANT_A, course_id: courseId, title: "L2", kind: "text", content: "b", position: 2, status: "draft" },
  ]);
  const quizId = randomUUID();
  await svc.from("quizzes").insert({ id: quizId, tenant_id: TENANT_A, course_id: courseId, title: "Quiz A", description: "Instrucciones del quiz", status: "published", weight: 2 });
  await svc.from("questions").insert({
    tenant_id: TENANT_A, quiz_id: quizId, kind: "true_false", prompt: "¿Verdadero?", body: { correct: true }, points: 1, position: 1,
  });
  await svc.from("assignments").insert({ tenant_id: TENANT_A, course_id: courseId, title: "Tarea A", status: "published", weight: 3 });
  return courseId;
}

beforeAll(() => {
  const e = env();
  apiUrl = e.apiUrl;
  anonKey = e.anonKey;
  jwtSecret = e.jwtSecret;
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
});

describe("cloneCourse — copia contenido + instrumentos, NUNCA runtime", () => {
  it("clona curso→borrador con lecciones/quizzes/preguntas/tareas, sin acciones ni inscripciones", async () => {
    const courseId = await seedCourseWithContent();
    // Una acción con inscripción sobre el curso origen (NO debe copiarse).
    const actionId = randomUUID();
    await svc.from("actions").insert({
      id: actionId, tenant_id: TENANT_A, course_id: courseId, codigo_accion: "ORIG-1",
      training_line: 3, environment: "rcetest", starts_on: "2026-07-01", ends_on: "2026-12-31", status: "active",
    });
    await svc.from("enrollments").insert({
      tenant_id: TENANT_A, action_id: actionId, user_id: "aaaaaaaa-0000-4000-8000-000000000005", run: "5126663-3",
    });

    const cloned = await cloneCourse(admin, courseId);
    if (!cloned.ok) throw new Error(JSON.stringify(cloned));
    const newCourseId = cloned.id;

    const { data: course } = await svc.from("courses").select("name, status, validity_months").eq("id", newCourseId).single();
    // ★ La vigencia (propiedad del curso normativo) sobrevive al clonado: sin esto
    // el certificado emitido desde la copia nacía sin vencimiento (4-ojos MED).
    expect(course).toMatchObject({ name: "Curso origen (copia)", status: "draft", validity_months: 24 });

    const { data: lessons } = await svc.from("lessons").select("title, status").eq("course_id", newCourseId).order("position");
    expect(lessons).toEqual([
      { title: "L1", status: "published" },
      { title: "L2", status: "draft" },
    ]);

    const { data: quizzes } = await svc.from("quizzes").select("id, title, description, weight").eq("course_id", newCourseId);
    expect(quizzes).toHaveLength(1);
    // Copia también la descripción (contenido del instructor), no solo título/peso.
    expect(quizzes![0]).toMatchObject({ title: "Quiz A", description: "Instrucciones del quiz", weight: 2 });
    const { data: questions } = await svc.from("questions").select("prompt").eq("quiz_id", quizzes![0]!.id);
    expect(questions).toHaveLength(1);

    const { data: assignments } = await svc.from("assignments").select("title, weight").eq("course_id", newCourseId);
    expect(assignments).toEqual([{ title: "Tarea A", weight: 3 }]);

    // NUNCA copia acciones ni inscripciones.
    const { count: actionCount } = await svc.from("actions").select("id", { count: "exact", head: true }).eq("course_id", newCourseId);
    expect(actionCount).toBe(0);

    const { data: audit } = await svc.from("audit_log").select("action").eq("entity_id", newCourseId).eq("action", "course.cloned");
    expect(audit).toHaveLength(1);
  });

  it("cross-tenant: no clona un curso de otro tenant", async () => {
    const courseId = await seedCourseWithContent();
    expect(await cloneCourse(adminB, courseId)).toEqual({ ok: false, error: "not_found" });
  });

  it("el RPC clone_course NO es invocable por un cliente authenticated (solo service_role)", async () => {
    const courseId = await seedCourseWithContent();
    const token = await new SignJWT({ role: "authenticated", tenant_id: TENANT_A, roles: ["otec_admin"] })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(admin.userId)
      .setAudience("authenticated")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(jwtSecret));
    const authed = createClient(apiUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { error } = await authed.rpc("clone_course", { p_tenant_id: TENANT_A, p_course_id: courseId });
    expect(error, "un cliente authenticated pudo ejecutar clone_course").not.toBeNull();
  });
});

describe("re-ejecución + gate de activación", () => {
  it("re-ejecuta a borrador con cloned_from; activar exige código nuevo y fechas", async () => {
    const courseId = await seedCourseWithContent();
    const actionId = randomUUID();
    await svc.from("actions").insert({
      id: actionId, tenant_id: TENANT_A, course_id: courseId, codigo_accion: "ORIG-2",
      training_line: 3, environment: "rcetest", starts_on: "2026-07-01", ends_on: "2026-12-31", status: "active",
    });

    const re = await reexecuteAction(admin, actionId);
    if (!re.ok) throw new Error(JSON.stringify(re));
    const { data: draft } = await svc.from("actions").select("status, cloned_from, starts_on, ends_on, codigo_accion").eq("id", re.id).single();
    expect(draft).toMatchObject({ status: "draft", cloned_from: actionId, starts_on: null, ends_on: null, codigo_accion: "ORIG-2" });

    const { data: audit } = await svc.from("audit_log").select("action").eq("entity_id", re.id).eq("action", "action.reexecuted");
    expect(audit).toHaveLength(1);

    // La ruta de UI (scheduleAndActivate): MISMO código que el origen → code_unchanged.
    expect(
      await scheduleAndActivate(admin, re.id, { codigoAccion: "ORIG-2", startsOn: "2027-01-01", endsOn: "2027-06-30" }),
    ).toEqual({ ok: false, error: "code_unchanged" });

    // Sin fechas → missing_dates.
    expect(
      await scheduleAndActivate(admin, re.id, { codigoAccion: "ORIG-2-B", startsOn: "", endsOn: "" }),
    ).toEqual({ ok: false, error: "missing_dates" });

    // Código nuevo + fechas → activa (la acción queda con esos datos) + audit.
    const activated = await scheduleAndActivate(admin, re.id, {
      codigoAccion: "ORIG-2-B",
      startsOn: "2027-01-01",
      endsOn: "2027-06-30",
    });
    expect(activated.ok).toBe(true);
    const { data: after } = await svc.from("actions").select("status, codigo_accion, starts_on, ends_on").eq("id", re.id).single();
    expect(after).toMatchObject({ status: "active", codigo_accion: "ORIG-2-B", starts_on: "2027-01-01", ends_on: "2027-06-30" });
    const { data: audit2 } = await svc.from("audit_log").select("action").eq("entity_id", re.id).eq("action", "action.activated");
    expect(audit2).toHaveLength(1);
  });

  it("no se inscribe en una acción en borrador (action_not_active)", async () => {
    const courseId = await seedCourseWithContent();
    const draftAction = randomUUID();
    await svc.from("actions").insert({
      id: draftAction, tenant_id: TENANT_A, course_id: courseId, codigo_accion: "DRAFT-1",
      training_line: 3, environment: "rcetest", status: "draft",
    });
    const r = await importEnrollmentsFromCsv(admin, draftAction, "nombre,email,run\nA,a@x.cl,5126663-3\n");
    expect(r).toEqual({ error: "action_not_active" });
  });
});
