/**
 * Integración del progreso del alumno (task 1.5): marca lecciones propias,
 * verifica propiedad de la inscripción, y no deja marcar a quien no está inscrito.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

import { completedLessonIds, setLessonProgress } from "@/modules/academico/progress-service";
import type { Principal } from "@/modules/core/domain/rbac";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const STUDENT_ID = "aaaaaaaa-0000-4000-8000-000000000005"; // alumno@otec-andes.test (inscrito)
const OTHER_ID = "aaaaaaaa-0000-4000-8000-000000000004"; // tutor (no inscrito como alumno)
const ENROLLMENT = "e0000000-0000-4000-8000-000000000001";

const student: Principal = { userId: STUDENT_ID, tenantId: TENANT_A, roles: ["student"] };
const notEnrolled: Principal = { userId: OTHER_ID, tenantId: TENANT_A, roles: ["tutor"] };

let firstLessonId = "";

beforeAll(async () => {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string) => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  process.env.NEXT_PUBLIC_SUPABASE_URL = get("API_URL");
  process.env.SUPABASE_SERVICE_ROLE_KEY = get("SERVICE_ROLE_KEY");
  const { createClient } = await import("@supabase/supabase-js");
  const svc = createClient(get("API_URL"), get("SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data } = await svc.from("lessons").select("id").eq("course_id", "c0000000-0000-4000-8000-000000000001").order("position").limit(1).single();
  firstLessonId = data!.id;
});

describe("progreso del alumno (task 1.5, HU-4.3)", () => {
  it("el alumno inscrito marca una lección como completada", async () => {
    expect(await setLessonProgress(student, firstLessonId, true)).toEqual({ ok: true });
    const done = await completedLessonIds(student, ENROLLMENT);
    expect(done.has(firstLessonId)).toBe(true);
  });

  it("desmarcar la deja como no completada", async () => {
    expect(await setLessonProgress(student, firstLessonId, false)).toEqual({ ok: true });
    const done = await completedLessonIds(student, ENROLLMENT);
    expect(done.has(firstLessonId)).toBe(false);
  });

  it("re-marcar es idempotente (upsert, no duplica)", async () => {
    await setLessonProgress(student, firstLessonId, true);
    await setLessonProgress(student, firstLessonId, true);
    const done = await completedLessonIds(student, ENROLLMENT);
    expect(done.has(firstLessonId)).toBe(true);
  });

  it("quien NO está inscrito no puede marcar progreso", async () => {
    expect(await setLessonProgress(notEnrolled, firstLessonId, true)).toEqual({ ok: false, error: "not_enrolled" });
  });

  it("una lección inexistente da lesson_not_found", async () => {
    expect(await setLessonProgress(student, "00000000-0000-4000-8000-000000000000", true)).toEqual({
      ok: false,
      error: "lesson_not_found",
    });
  });
});
