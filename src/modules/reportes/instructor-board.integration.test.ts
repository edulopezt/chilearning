/**
 * Integración del tablero del relator (task 1.8): agrega avance/asistencia por
 * acción y calcula el semáforo. Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { getInstructorBoard } from "@/modules/reportes/instructor-board";
import type { Principal } from "@/modules/core/domain/rbac";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const DEMO_ACTION = "ac000000-0000-4000-8000-000000000001";

const instructor: Principal = { userId: "i", tenantId: TENANT_A, roles: ["instructor"] };
const student: Principal = { userId: "s", tenantId: TENANT_A, roles: ["student"] };

let svc: SupabaseClient;

beforeAll(() => {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string) => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  process.env.NEXT_PUBLIC_SUPABASE_URL = get("API_URL");
  process.env.SUPABASE_SERVICE_ROLE_KEY = get("SERVICE_ROLE_KEY");
  svc = createClient(get("API_URL"), get("SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
});

describe("tablero del relator (task 1.8, HU-3.4)", () => {
  it("un student no ve el tablero (deny-by-default)", async () => {
    expect(await getInstructorBoard(student)).toEqual([]);
  });

  it("el relator ve la acción demo con sus métricas y semáforo", async () => {
    const board = await getInstructorBoard(instructor);
    const demo = board.find((r) => r.actionId === DEMO_ACTION);
    expect(demo).toBeDefined();
    expect(demo!.enrolled).toBeGreaterThanOrEqual(1);
    expect(["green", "yellow", "red"]).toContain(demo!.semaforo.color);
  });

  it("una acción con avance completo muestra 100% y semáforo verde (fixture aislado)", async () => {
    // Fixture propio para no depender del estado que otros tests dejan en la
    // acción demo (p.ej. el import de alumnos, que la llena de inscritos).
    const courseId = "cf000000-0000-4000-8000-0000000008a1";
    const actionId = "af000000-0000-4000-8000-0000000008a1";
    const enrollmentId = "ef000000-0000-4000-8000-0000000008a1";
    const lessonId = "1f000000-0000-4000-8000-0000000008a1";
    const studentId = "aaaaaaaa-0000-4000-8000-000000000005";

    await svc.from("courses").upsert({ id: courseId, tenant_id: TENANT_A, name: "Curso tablero", sence: false });
    await svc.from("actions").upsert({ id: actionId, tenant_id: TENANT_A, course_id: courseId, codigo_accion: "BOARD-1", training_line: 3, environment: "rcetest", attendance_lock: false });
    await svc.from("lessons").upsert({ id: lessonId, tenant_id: TENANT_A, course_id: courseId, title: "L1", kind: "text", content: "x", position: 1, status: "published" });
    await svc.from("enrollments").upsert({ id: enrollmentId, tenant_id: TENANT_A, action_id: actionId, user_id: studentId, run: "5126663-3", exento: false });

    const before = (await getInstructorBoard(instructor)).find((r) => r.actionId === actionId)!;
    expect(before.avgProgressPct).toBe(0);

    await svc.from("lesson_progress").upsert(
      { tenant_id: TENANT_A, enrollment_id: enrollmentId, lesson_id: lessonId, completed: true, completed_at: new Date().toISOString() },
      { onConflict: "enrollment_id,lesson_id" },
    );

    const after = (await getInstructorBoard(instructor)).find((r) => r.actionId === actionId)!;
    expect(after.enrolled).toBe(1);
    expect(after.avgProgressPct).toBe(100);
    expect(after.semaforo.color).toBe("green"); // sin candado, solo avance
  });

  it("las filas vienen ordenadas por riesgo (rojo primero)", async () => {
    const board = await getInstructorBoard(instructor);
    const scores = board.map((r) => r.semaforo.score);
    expect([...scores]).toEqual([...scores].sort((a, b) => a - b));
  });
});
