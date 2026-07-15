/**
 * GATE de la task 2.5 (capa de servicios): TODA mutación pública devuelve
 * `forbidden` (o su equivalente) para un Principal `supervisor`. Fija como
 * regresión que ningún MANAGERS/escritura incluya al fiscalizador.
 *
 * ⚠ CHECKLIST: al agregar un servicio con mutaciones nuevas (quizzes, tareas,
 * clonado…), añade su caso aquí.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

import { createCourse, updateCourse } from "@/modules/academico/course-service";
import { createAction, updateAction } from "@/modules/academico/action-service";
import { createLesson, deleteLesson, moveLesson, updateLesson } from "@/modules/academico/lesson-service";
import { importEnrollmentsFromCsv } from "@/modules/academico/enrollment-service";
import { setLessonProgress } from "@/modules/academico/progress-service";
import { markGuideSent, sendClaveUnicaGuide } from "@/modules/comunicacion/guide-service";
import { saveBranding } from "@/modules/core/branding-service";
import type { Principal } from "@/modules/core/domain/rbac";
import { createQuestion, createQuiz, deleteQuiz, publishQuiz, updateQuiz } from "@/modules/evaluacion/quiz-service";
import { startAttempt } from "@/modules/evaluacion/attempt-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const DEMO_COURSE = "c0000000-0000-4000-8000-000000000001";
const DEMO_ACTION = "ac000000-0000-4000-8000-000000000001";

const supervisor: Principal = {
  userId: "aaaaaaaa-0000-4000-8000-000000000007",
  tenantId: TENANT_A,
  roles: ["supervisor"],
};

beforeAll(() => {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string) => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  process.env.NEXT_PUBLIC_SUPABASE_URL = get("API_URL");
  process.env.SUPABASE_SERVICE_ROLE_KEY = get("SERVICE_ROLE_KEY");
});

describe("supervisor: toda mutación de servicio → forbidden (task 2.5)", () => {
  it("cursos: crear/editar", async () => {
    expect(await createCourse(supervisor, { name: "X" })).toEqual({ ok: false, error: "forbidden" });
    expect(await updateCourse(supervisor, DEMO_COURSE, { name: "X" })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("acciones: crear/editar", async () => {
    expect(
      await createAction(supervisor, { courseId: DEMO_COURSE, codigoAccion: "SUP-1" }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await updateAction(supervisor, DEMO_ACTION, { codigoAccion: "SUP-2" })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("lecciones: crear/editar/mover/borrar", async () => {
    const draft = { title: "X", kind: "text", content: "y", status: "draft" } as const;
    expect(await createLesson(supervisor, DEMO_COURSE, draft)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      await updateLesson(supervisor, "00000000-0000-4000-8000-000000000000", draft),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await moveLesson(supervisor, "00000000-0000-4000-8000-000000000000", "up")).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await deleteLesson(supervisor, "00000000-0000-4000-8000-000000000000")).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("inscripciones: importar CSV", async () => {
    expect(
      await importEnrollmentsFromCsv(supervisor, DEMO_ACTION, "nombre,email,run\nA,a@x.cl,5126663-3\n"),
    ).toEqual({ error: "forbidden" });
  });

  it("progreso: no puede marcar lecciones (no es alumno inscrito)", async () => {
    const result = await setLessonProgress(
      supervisor,
      "00000000-0000-4000-8000-000000000000",
      true,
    );
    expect(result.ok).toBe(false);
  });

  it("marca del tenant: no puede editarla", async () => {
    expect(
      await saveBranding(supervisor, {
        primaryColor: "#000000",
        accentColor: "#ffffff",
        logoUrl: "",
        name: "Pirata",
        rut: "",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
  });

  it("evaluación (task 2.1): ni crear/editar/publicar quizzes ni rendirlos", async () => {
    const DEMO_QUIZ = "a0000000-0000-4000-8000-000000000001";
    expect(await createQuiz(supervisor, DEMO_COURSE, { title: "X" })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await updateQuiz(supervisor, DEMO_QUIZ, { title: "X" })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await publishQuiz(supervisor, DEMO_QUIZ, false)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await deleteQuiz(supervisor, DEMO_QUIZ)).toEqual({ ok: false, error: "forbidden" });
    expect(
      await createQuestion(supervisor, DEMO_QUIZ, { kind: "true_false", prompt: "X", correct: true }),
    ).toEqual({ ok: false, error: "forbidden" });
    // No está inscrito: tampoco puede rendir.
    const start = await startAttempt(supervisor, DEMO_QUIZ);
    expect(start.ok).toBe(false);
  });

  it("guía Clave Única: ni enviar ni marcar", async () => {
    expect(
      await sendClaveUnicaGuide(supervisor, DEMO_ACTION, { courseUrl: "https://x.cl" }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await markGuideSent(supervisor, DEMO_ACTION)).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});
