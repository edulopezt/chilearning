/**
 * Integración del reproductor SCORM (task 5.1b, HU-4.2, ADR-006): resolución
 * de acceso (staff/alumno), persistencia CMI y resultados, contra Postgres
 * real. Requiere `supabase start` + `supabase db reset`.
 *
 * Sigue el patrón del resto de la suite `integration`: se prueban las
 * funciones de SERVICIO directamente con un `Principal` construido a mano
 * (no se invocan los route handlers: `getPrincipal()` depende del contexto de
 * request de Next — `next/headers` — que no existe fuera de un request real;
 * ningún otro test de este repo invoca un route handler por esa misma razón).
 * Las rutas API son wrappers delgados que solo traducen estos resultados
 * discriminados a status HTTP (401/404/413/200) — sin lógica propia que testear.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sanitizeScormPath } from "@/modules/contenido/domain/scorm-zip";
import {
  getScormCmiState,
  listScormResults,
  resolveStaffPackageAccess,
  resolveStudentScormAccess,
  saveScormCmiState,
} from "@/modules/contenido/scorm-runtime-service";
import type { Principal } from "@/modules/core/domain/rbac";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const STUDENT_A = "aaaaaaaa-0000-4000-8000-000000000005"; // seed: student, tenant A
const STAFF_A = "aaaaaaaa-0000-4000-8000-000000000001"; // seed: otec_admin, tenant A
const STUDENT_B = "bbbbbbbb-0000-4000-8000-000000000005"; // seed: student, tenant B
const NOT_ENROLLED_USER = randomUUID(); // nunca se inserta en auth.users a propósito: 0 filas de enrollment le calzan igual.

function studentPrincipal(userId: string, tenantId: string): Principal {
  return { userId, tenantId, roles: ["student"] };
}
function staffPrincipal(userId: string, tenantId: string): Principal {
  return { userId, tenantId, roles: ["otec_admin"] };
}

let svc: SupabaseClient;

function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

interface Fixture {
  readonly courseId: string;
  readonly actionId: string;
  readonly lessonId: string;
  readonly packageId: string;
  readonly enrollmentId: string;
}

const seededCourses: string[] = [];

/** Curso + acción + lección scorm `published` + paquete `ready` + inscripción, todo en TENANT_A. */
async function seedScormFixture(opts: {
  attendanceLock: boolean;
  studentUserId?: string;
  scormVersion?: "1.2" | "2004";
  skipEnrollment?: boolean;
}): Promise<Fixture> {
  const courseId = randomUUID();
  const actionId = randomUUID();
  const packageId = randomUUID();
  const lessonId = randomUUID();

  const { error: courseErr } = await svc
    .from("courses")
    .insert({ id: courseId, tenant_id: TENANT_A, name: "Curso de integración SCORM (ficticio)" });
  if (courseErr) throw new Error(`seed courses: ${courseErr.message}`);
  seededCourses.push(courseId);

  const { error: actionErr } = await svc.from("actions").insert({
    id: actionId,
    tenant_id: TENANT_A,
    course_id: courseId,
    codigo_accion: `ACC-SCORM-${actionId.slice(0, 8)}`,
    training_line: 3,
    environment: "rcetest",
    attendance_lock: opts.attendanceLock,
  });
  if (actionErr) throw new Error(`seed actions: ${actionErr.message}`);

  const { error: pkgErr } = await svc.from("scorm_packages").insert({
    id: packageId,
    tenant_id: TENANT_A,
    course_id: courseId,
    title: "Paquete de integración (ficticio)",
    status: "ready",
    scorm_version: opts.scormVersion ?? "1.2",
    zip_path: `${TENANT_A}/${packageId}/package.zip`,
    extracted_prefix: `${TENANT_A}/${packageId}/ext`,
    entry_href: "index.html",
    uploaded_by: STAFF_A,
    file_size: 1000,
  });
  if (pkgErr) throw new Error(`seed scorm_packages: ${pkgErr.message}`);

  const { error: lessonErr } = await svc.from("lessons").insert({
    id: lessonId,
    tenant_id: TENANT_A,
    course_id: courseId,
    title: "Lección SCORM de integración",
    kind: "scorm",
    content: packageId,
    position: 1,
    status: "published",
  });
  if (lessonErr) throw new Error(`seed lessons: ${lessonErr.message}`);

  let enrollmentId = "";
  if (!opts.skipEnrollment) {
    enrollmentId = randomUUID();
    const { error: enrErr } = await svc.from("enrollments").insert({
      id: enrollmentId,
      tenant_id: TENANT_A,
      action_id: actionId,
      user_id: opts.studentUserId ?? STUDENT_A,
      run: "5126663-3",
      exento: false,
      first_names: "Alumno",
      last_names: "De Integración",
    });
    if (enrErr) throw new Error(`seed enrollments: ${enrErr.message}`);
  }

  return { courseId, actionId, lessonId, packageId, enrollmentId };
}

async function cleanupCourse(courseId: string): Promise<void> {
  // Orden: hijos antes que padres (FKs `on delete restrict`).
  const { data: actions } = await svc.from("actions").select("id").eq("course_id", courseId);
  const actionIds = (actions ?? []).map((a) => a.id as string);

  const { data: enrollments } = actionIds.length
    ? await svc.from("enrollments").select("id").in("action_id", actionIds)
    : { data: [] as { id: string }[] };
  const enrollmentIds = (enrollments ?? []).map((e) => e.id as string);

  if (enrollmentIds.length) {
    await svc.from("scorm_cmi").delete().in("enrollment_id", enrollmentIds);
    await svc.from("lesson_progress").delete().in("enrollment_id", enrollmentIds);
    await svc.from("enrollments").delete().in("id", enrollmentIds);
  }
  await svc.from("lessons").delete().eq("course_id", courseId);
  await svc.from("scorm_packages").delete().eq("course_id", courseId);
  await svc.from("actions").delete().eq("course_id", courseId);
  await svc.from("courses").delete().eq("id", courseId);
}

beforeAll(() => {
  const e = env();
  // Las funciones de servicio bajo prueba usan `tenantGuard()` → `serverEnv()`,
  // que lee estas dos vars de `process.env` (nunca de `.env.local`, que en este
  // repo apunta al proyecto CLOUD de staging): se fuerzan a las credenciales
  // LOCALES antes de invocar cualquier servicio (mismo patrón que
  // `gradebook-service.integration.test.ts`/`live-session-service.integration.test.ts`).
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
});

afterAll(async () => {
  for (const courseId of seededCourses) {
    await cleanupCourse(courseId);
  }
});

describe("resolveStaffPackageAccess (task 5.1b)", () => {
  it("staff de gestión accede a un paquete `ready` de su tenant SIN estar inscrito", async () => {
    const fx = await seedScormFixture({ attendanceLock: false, skipEnrollment: true });
    const result = await resolveStaffPackageAccess(staffPrincipal(STAFF_A, TENANT_A), fx.packageId);
    expect(result.ok).toBe(true);
  });

  it("staff de OTRO tenant → sin acceso (paquete no existe bajo su tenantGuard)", async () => {
    const fx = await seedScormFixture({ attendanceLock: false, skipEnrollment: true });
    const result = await resolveStaffPackageAccess(staffPrincipal(STUDENT_B, TENANT_B), fx.packageId);
    expect(result.ok).toBe(false);
  });
});

describe("resolveStudentScormAccess — lookup por PAQUETE (proxy de assets, task 5.1b)", () => {
  it("alumno inscrito en el curso del paquete → acceso ok", async () => {
    const fx = await seedScormFixture({ attendanceLock: false });
    const result = await resolveStudentScormAccess(studentPrincipal(STUDENT_A, TENANT_A), {
      by: "package",
      packageId: fx.packageId,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.access.extractedPrefix).toBe(`${TENANT_A}/${fx.packageId}/ext`);
      expect(result.access.entryHref).toBe("index.html");
    }
  });

  it("el candado de asistencia CERRADO NO bloquea el proxy de assets (regla explícita del PR)", async () => {
    const fx = await seedScormFixture({ attendanceLock: true }); // sin sence_sessions → candado cerrado
    const result = await resolveStudentScormAccess(studentPrincipal(STUDENT_A, TENANT_A), {
      by: "package",
      packageId: fx.packageId,
    });
    expect(result.ok).toBe(true);
  });

  it("alumno del TENANT B pidiendo un packageId del TENANT A → sin acceso (404, no fuga de existencia)", async () => {
    const fx = await seedScormFixture({ attendanceLock: false });
    const result = await resolveStudentScormAccess(studentPrincipal(STUDENT_B, TENANT_B), {
      by: "package",
      packageId: fx.packageId,
    });
    expect(result.ok).toBe(false);
  });

  it("un asset con ruta traversal (`../../etc/passwd`) nunca llega a Storage: sanitizeScormPath lo rechaza ANTES", () => {
    // Reafirma, en el contexto específico del proxy SCORM, que el saneo (ya
    // cubierto exhaustivamente en `scorm-zip.test.ts`, task 5.1a) sigue
    // bloqueando el traversal — la ruta jamás alcanza `storage.download()`.
    expect(sanitizeScormPath("../../etc/passwd")).toEqual({ ok: false });
    expect(sanitizeScormPath("a/../../b")).toEqual({ ok: false });
    expect(sanitizeScormPath("//etc/passwd")).toEqual({ ok: false });
  });
});

describe("resolveStudentScormAccess — lookup por LECCIÓN (endpoint CMI, task 5.1b)", () => {
  it("alumno SIN inscripción en el curso de esa lección (inscrito en OTRO curso) → sin acceso", async () => {
    const fx = await seedScormFixture({ attendanceLock: false, skipEnrollment: true });
    const result = await resolveStudentScormAccess(studentPrincipal(NOT_ENROLLED_USER, TENANT_A), {
      by: "lesson",
      lessonId: fx.lessonId,
    });
    expect(result.ok).toBe(false);
  });

  it("candado de asistencia CERRADO → sin acceso (a diferencia del proxy de assets)", async () => {
    const fx = await seedScormFixture({ attendanceLock: true }); // sin sence_sessions → cerrado
    const result = await resolveStudentScormAccess(studentPrincipal(STUDENT_A, TENANT_A), {
      by: "lesson",
      lessonId: fx.lessonId,
    });
    expect(result.ok).toBe(false);
  });

  it("candado ABIERTO (attendance_lock=false) → acceso ok", async () => {
    const fx = await seedScormFixture({ attendanceLock: false });
    const result = await resolveStudentScormAccess(studentPrincipal(STUDENT_A, TENANT_A), {
      by: "lesson",
      lessonId: fx.lessonId,
    });
    expect(result.ok).toBe(true);
  });
});

describe("getScormCmiState / saveScormCmiState (task 5.1b)", () => {
  it("GET antes de cualquier intento → estado vacío por defecto (primer intento)", async () => {
    const fx = await seedScormFixture({ attendanceLock: false });
    const state = await getScormCmiState(studentPrincipal(STUDENT_A, TENANT_A), fx.lessonId);
    expect(state).toEqual({ cmi: {}, lessonStatus: null, scoreRaw: null });
  });

  it("POST con completed=true → upsert de scorm_cmi Y marca lesson_progress completado", async () => {
    const fx = await seedScormFixture({ attendanceLock: false });
    const principal = studentPrincipal(STUDENT_A, TENANT_A);
    const cmi = { core: { lesson_status: "completed", score: { raw: "88" } } };

    const result = await saveScormCmiState(principal, fx.lessonId, cmi);
    expect(result).toEqual({ ok: true });

    const state = await getScormCmiState(principal, fx.lessonId);
    expect(state).toEqual({ cmi, lessonStatus: "completed", scoreRaw: 88 });

    const { data: progress } = await svc
      .from("lesson_progress")
      .select("completed")
      .eq("enrollment_id", fx.enrollmentId)
      .eq("lesson_id", fx.lessonId)
      .maybeSingle();
    expect(progress?.completed).toBe(true);
  });

  it("CMI de más de 256 KB → too_large (413 en la ruta), NO se escribe nada", async () => {
    const fx = await seedScormFixture({ attendanceLock: false });
    const principal = studentPrincipal(STUDENT_A, TENANT_A);
    const oversized = { core: { suspend_data: "A".repeat(300_000) } };

    const result = await saveScormCmiState(principal, fx.lessonId, oversized);
    expect(result).toEqual({ ok: false, error: "too_large" });

    const { data: row } = await svc
      .from("scorm_cmi")
      .select("id")
      .eq("enrollment_id", fx.enrollmentId)
      .eq("package_id", fx.packageId)
      .maybeSingle();
    expect(row).toBeNull();
  });

  it("alumno sin inscripción en el curso → not_found (nunca escribe)", async () => {
    const fx = await seedScormFixture({ attendanceLock: false, skipEnrollment: true });
    const result = await saveScormCmiState(studentPrincipal(NOT_ENROLLED_USER, TENANT_A), fx.lessonId, {
      core: { lesson_status: "incomplete" },
    });
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("candado cerrado → not_found (404, NUNCA 403: la ruta no distingue el motivo)", async () => {
    const fx = await seedScormFixture({ attendanceLock: true });
    const principal = studentPrincipal(STUDENT_A, TENANT_A);

    const saveResult = await saveScormCmiState(principal, fx.lessonId, { core: { lesson_status: "completed" } });
    expect(saveResult).toEqual({ ok: false, error: "not_found" });

    const getResult = await getScormCmiState(principal, fx.lessonId);
    expect(getResult).toBeNull();
  });

  it("SCORM 2004: completion_status=incomplete + success_status=passed → completed=true, score desde scaled", async () => {
    const fx = await seedScormFixture({ attendanceLock: false, scormVersion: "2004" });
    const principal = studentPrincipal(STUDENT_A, TENANT_A);
    const cmi = { completion_status: "incomplete", success_status: "passed", score: { scaled: 0.75 } };

    const result = await saveScormCmiState(principal, fx.lessonId, cmi);
    expect(result).toEqual({ ok: true });

    const state = await getScormCmiState(principal, fx.lessonId);
    expect(state?.lessonStatus).toBe("passed");
    expect(state?.scoreRaw).toBe(75);

    const { data: progress } = await svc
      .from("lesson_progress")
      .select("completed")
      .eq("enrollment_id", fx.enrollmentId)
      .eq("lesson_id", fx.lessonId)
      .maybeSingle();
    expect(progress?.completed).toBe(true);
  });
});

describe("listScormResults (panel admin, task 5.1b)", () => {
  it("lista el intento del alumno con nombre, estado y nota", async () => {
    const fx = await seedScormFixture({ attendanceLock: false });
    const principal = studentPrincipal(STUDENT_A, TENANT_A);
    await saveScormCmiState(principal, fx.lessonId, { core: { lesson_status: "passed", score: { raw: 95 } } });

    const results = await listScormResults(staffPrincipal(STAFF_A, TENANT_A), fx.packageId);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      enrollmentId: fx.enrollmentId,
      lessonStatus: "passed",
      scoreRaw: 95,
    });
    expect(results[0]!.studentName).toContain("Integración");
  });

  it("un principal sin rol de gestión → lista vacía (deny-by-default)", async () => {
    const fx = await seedScormFixture({ attendanceLock: false, skipEnrollment: true });
    const results = await listScormResults(studentPrincipal(STUDENT_A, TENANT_A), fx.packageId);
    expect(results).toEqual([]);
  });
});
