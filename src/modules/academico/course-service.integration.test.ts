/**
 * Integración del CRUD de cursos (task 1.1): crea/lista/edita vía tenantGuard,
 * respeta permisos y aislamiento entre tenants.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

import { createCourse, listCourses, updateCourse, updateCourseValidity } from "@/modules/academico/course-service";
import type { Principal } from "@/modules/core/domain/rbac";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const adminA: Principal = { userId: "a", tenantId: TENANT_A, roles: ["otec_admin"] };
const coordA: Principal = { userId: "c", tenantId: TENANT_A, roles: ["coordinator"] };
const studentA: Principal = { userId: "s", tenantId: TENANT_A, roles: ["student"] };
const adminB: Principal = { userId: "b", tenantId: TENANT_B, roles: ["otec_admin"] };

const validInput = {
  name: "Trabajo en altura",
  modality: "elearning",
  hours: "16",
  sence: "true",
  codSence: "1234567890",
  status: "draft",
  completionRules: { requireAllLessons: true, requireSurvey: false, minAttendancePct: 75 },
};

beforeAll(() => {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string) => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  process.env.NEXT_PUBLIC_SUPABASE_URL = get("API_URL");
  process.env.SUPABASE_SERVICE_ROLE_KEY = get("SERVICE_ROLE_KEY");
});

describe("CRUD de cursos (task 1.1, HU-3.1/4.4)", () => {
  it("un student no puede crear (deny-by-default)", async () => {
    const r = await createCourse(studentA, validInput);
    expect(r).toEqual({ ok: false, error: "forbidden" });
  });

  it("rechaza entrada inválida con errores de campo", async () => {
    const r = await createCourse(adminA, { ...validInput, name: "", hours: "-1" });
    expect("validation" in r).toBe(true);
    if ("validation" in r) {
      expect(r.validation.map((e) => e.field).sort()).toEqual(["hours", "name"]);
    }
  });

  it("el admin crea un curso y aparece en el listado con sus reglas", async () => {
    const r = await createCourse(adminA, validInput);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const courses = await listCourses(adminA);
    const created = courses.find((c) => c.id === r.id);
    expect(created?.name).toBe("Trabajo en altura");
    expect(created?.hours).toBe(16);
    expect(created?.cod_sence).toBe("1234567890");
    expect(created?.completion_rules).toMatchObject({ minAttendancePct: 75 });
  });

  it("el coordinador también puede crear (matriz §3)", async () => {
    const r = await createCourse(coordA, { ...validInput, name: "Curso del coordinador" });
    expect(r.ok).toBe(true);
  });

  it("no se puede editar un curso de OTRO tenant (aislamiento)", async () => {
    const created = await createCourse(adminA, { ...validInput, name: "Solo de A" });
    if (!created.ok) throw new Error("no se creó");

    const r = await updateCourse(adminB, created.id, { ...validInput, name: "Hackeado" });
    expect(r).toEqual({ ok: false, error: "not_found" });

    // El curso de A sigue intacto.
    const courses = await listCourses(adminA);
    expect(courses.find((c) => c.id === created.id)?.name).toBe("Solo de A");
  });

  it("el admin del tenant B no ve los cursos del tenant A", async () => {
    const coursesB = await listCourses(adminB);
    expect(coursesB.every((c) => c.name !== "Trabajo en altura")).toBe(true);
  });
});

describe("updateCourseValidity — edición acotada de la vigencia (task 5.12, 4-ojos MED)", () => {
  it("fija la vigencia de un curso YA existente y la deja consultable", async () => {
    const created = await createCourse(adminA, { ...validInput, name: "Curso normativo sin vigencia" });
    if (!created.ok) throw new Error("no se creó");
    // Nace sin vigencia (el default: no vence).
    let course = (await listCourses(adminA)).find((c) => c.id === created.id);
    expect(course?.validity_months).toBeNull();

    const r = await updateCourseValidity(adminA, created.id, "24");
    expect(r).toEqual({ ok: true, id: created.id });

    course = (await listCourses(adminA)).find((c) => c.id === created.id);
    expect(course?.validity_months).toBe(24);

    // Vacío ⇒ vuelve a "no vence" (null), sin error.
    expect((await updateCourseValidity(adminA, created.id, "")).ok).toBe(true);
    course = (await listCourses(adminA)).find((c) => c.id === created.id);
    expect(course?.validity_months).toBeNull();
  });

  it("PATCH acotado: cambiar la vigencia NO altera el resto del curso", async () => {
    const created = await createCourse(adminA, { ...validInput, name: "Curso intacto", hours: "40" });
    if (!created.ok) throw new Error("no se creó");
    await updateCourseValidity(adminA, created.id, "12");
    const course = (await listCourses(adminA)).find((c) => c.id === created.id);
    expect(course).toMatchObject({ name: "Curso intacto", hours: 40, cod_sence: "1234567890", validity_months: 12 });
  });

  it("rechaza una vigencia fuera de rango con error de campo", async () => {
    const created = await createCourse(adminA, { ...validInput, name: "Curso rango" });
    if (!created.ok) throw new Error("no se creó");
    const r = await updateCourseValidity(adminA, created.id, "999");
    expect("validation" in r).toBe(true);
    if ("validation" in r) expect(r.validation[0]?.field).toBe("validityMonths");
  });

  it("un student no puede editar la vigencia (deny-by-default)", async () => {
    const created = await createCourse(adminA, { ...validInput, name: "Curso denegado" });
    if (!created.ok) throw new Error("no se creó");
    expect(await updateCourseValidity(studentA, created.id, "12")).toEqual({ ok: false, error: "forbidden" });
  });

  it("no edita la vigencia de un curso de OTRO tenant (aislamiento)", async () => {
    const created = await createCourse(adminA, { ...validInput, name: "Solo de A vigencia" });
    if (!created.ok) throw new Error("no se creó");
    expect(await updateCourseValidity(adminB, created.id, "12")).toEqual({ ok: false, error: "not_found" });
    const course = (await listCourses(adminA)).find((c) => c.id === created.id);
    expect(course?.validity_months).toBeNull();
  });
});
