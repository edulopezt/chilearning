/**
 * Integración del asistente de creación de cursos (task 5.10, HU-3.5/4.5):
 * flujo "desde cero" de punta a punta, los bloqueos de `validateForGeneration`
 * cuando el estado queda incoherente entre pasos, la idempotencia de
 * `generateFromDraft` y el flujo "desde descriptor SENCE" (.docx sintético).
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

import { listLessons } from "@/modules/academico/lesson-service";
import type { Principal } from "@/modules/core/domain/rbac";
import { listQuizzesByCourse } from "@/modules/evaluacion/quiz-service";
import { listSurveysByCourse } from "@/modules/evaluacion/survey-service";
import { buildDescriptorFixtureDocx, DESCRIPTOR_FIXTURE_LINES } from "./testing/descriptor-fixture";
import {
  createDraft,
  descriptorDownloadUrl,
  discardDraft,
  generateFromDraft,
  getDraft,
  listDrafts,
  saveStep,
} from "./wizard-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const adminA: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };
const coordA: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000002", tenantId: TENANT_A, roles: ["coordinator"] };
const studentA: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000005", tenantId: TENANT_A, roles: ["student"] };
const adminB: Principal = { userId: "bbbbbbbb-0000-4000-8000-000000000001", tenantId: TENANT_B, roles: ["otec_admin"] };

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

beforeAll(() => {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string) => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  process.env.NEXT_PUBLIC_SUPABASE_URL = get("API_URL");
  process.env.SUPABASE_SERVICE_ROLE_KEY = get("SERVICE_ROLE_KEY");
});

/** Arma un draft SENCE con `moduleCount` módulos de `hoursPerModule` horas c/u, ya en el paso "datos"+"estructura". */
async function seedSenceDraft(
  principal: Principal,
  moduleCount: number,
  hoursPerModule: number,
): Promise<string> {
  const created = await createDraft(principal, { source: "scratch" });
  if (!created.ok) throw new Error("no se creó el draft");
  const totalHours = moduleCount * hoursPerModule;

  const datos = await saveStep(principal, created.draftId, "datos", {
    name: "Curso del asistente (integración)",
    modality: "elearning",
    hours: String(totalHours),
    sence: "true",
    codSence: "1234567890",
  });
  if (!datos.ok) throw new Error(`paso datos inválido: ${JSON.stringify(datos)}`);

  const modules = Array.from({ length: moduleCount }, (_, i) => ({
    title: `Módulo ${i + 1}`,
    hours: String(hoursPerModule),
  }));
  const estructura = await saveStep(principal, created.draftId, "estructura", { modules });
  if (!estructura.ok) throw new Error(`paso estructura inválido: ${JSON.stringify(estructura)}`);

  return created.draftId;
}

describe("wizard-service — permisos", () => {
  it("un student no puede crear un draft (deny-by-default)", async () => {
    const r = await createDraft(studentA, { source: "scratch" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("wizard-service — flujo 'desde cero' de punta a punta", () => {
  it("genera curso + lecciones + evaluaciones + encuesta, todo en borrador y con posiciones correctas", async () => {
    const draftId = await seedSenceDraft(adminA, 3, 4); // 3 módulos × 4h = 12h

    const aprendizajes = await saveStep(adminA, draftId, "aprendizajes", {
      m1: "Reconocer el riesgo\nAplicar el protocolo",
      m2: ["Usar el equipo correctamente"],
    });
    expect(aprendizajes.ok).toBe(true);

    const contenido = await saveStep(adminA, draftId, "contenido", {
      lessons: [
        { moduleId: "m1", title: "Lección 1.1", kind: "text", content: "Contenido de la lección 1.1" },
        { moduleId: "m2", title: "Lección 2.1", kind: "text", content: "Contenido de la lección 2.1" },
      ],
    });
    expect(contenido.ok).toBe(true);

    const evaluaciones = await saveStep(adminA, draftId, "evaluaciones", {
      quizzes: [
        { moduleId: "m1", title: "Evaluación módulo 1" },
        { moduleId: "m2", title: "Evaluación módulo 2" },
        { moduleId: "m3", title: "Evaluación módulo 3" },
      ],
      survey: { enabled: true, title: "Encuesta de satisfacción" },
    });
    expect(evaluaciones.ok).toBe(true);

    const completitud = await saveStep(adminA, draftId, "completitud", {
      requireAllLessons: "on",
      requireSurvey: "on",
      minAttendancePct: "75",
    });
    expect(completitud.ok).toBe(true);

    const revision = await saveStep(adminA, draftId, "revision", {});
    expect(revision.ok).toBe(true);

    const result = await generateFromDraft(adminA, draftId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const courseId = result.courseId;

    // 3 módulos: cada uno con su lección-cabecera + la lección de contenido que
    // le corresponde (solo m1 y m2 tienen); m3 solo trae la cabecera.
    const lessons = await listLessons(adminA, courseId);
    expect(lessons).toHaveLength(5);
    expect(lessons.every((l) => l.status === "draft")).toBe(true);
    expect(lessons.map((l) => l.position)).toEqual([1, 2, 3, 4, 5]);
    expect(lessons[0]?.title).toContain("Módulo 1");
    expect(lessons[1]?.title).toBe("Lección 1.1");
    expect(lessons[2]?.title).toContain("Módulo 2");
    expect(lessons[3]?.title).toBe("Lección 2.1");
    expect(lessons[4]?.title).toContain("Módulo 3");

    const quizzes = await listQuizzesByCourse(adminA, courseId);
    expect(quizzes.map((q) => q.title).sort()).toEqual([
      "Evaluación módulo 1",
      "Evaluación módulo 2",
      "Evaluación módulo 3",
    ]);
    expect(quizzes.every((q) => q.status === "draft")).toBe(true);

    const surveys = await listSurveysByCourse(adminA, courseId);
    expect(surveys).toHaveLength(1);
    expect(surveys[0]?.title).toBe("Encuesta de satisfacción");
    expect(surveys[0]?.status).toBe("draft");

    const draftAfter = await getDraft(adminA, draftId);
    expect(draftAfter?.status).toBe("generated");
    expect(draftAfter?.generatedCourseId).toBe(courseId);

    // Segunda llamada sobre un draft YA generado: se rechaza SIN duplicar nada.
    const second = await generateFromDraft(adminA, draftId);
    expect(second).toEqual({ ok: false, error: "already_generated" });
    expect(await listLessons(adminA, courseId)).toHaveLength(5);
    expect(await listQuizzesByCourse(adminA, courseId)).toHaveLength(3);
    expect(await listSurveysByCourse(adminA, courseId)).toHaveLength(1);
  });

  it("el coordinador también puede correr el asistente completo (matriz §3)", async () => {
    const draftId = await seedSenceDraft(coordA, 1, 2);
    await saveStep(coordA, draftId, "evaluaciones", {
      quizzes: [{ moduleId: "m1", title: "Evaluación única" }],
      survey: { enabled: true, title: "Encuesta" },
    });
    await saveStep(coordA, draftId, "completitud", { requireSurvey: "on" });
    const result = await generateFromDraft(coordA, draftId);
    expect(result.ok).toBe(true);
  });
});

describe("wizard-service — bloqueos de validateForGeneration (estado incoherente entre pasos)", () => {
  it("horas incoherentes (se edita 'datos' DESPUÉS de fijar 'estructura'): bloquea sin generar nada", async () => {
    const draftId = await seedSenceDraft(adminA, 2, 4); // 8h, estructura ya guardada en 8h
    // Vuelve al paso "datos" y sube las horas del curso a 99 SIN retocar la
    // estructura: el draft queda con una incoherencia real, la misma que
    // produciría un coordinador que retrocede en el stepper.
    const datos = await saveStep(adminA, draftId, "datos", {
      name: "Curso con horas movidas",
      modality: "elearning",
      hours: "99",
      sence: "true",
      codSence: "1234567890",
    });
    expect(datos.ok).toBe(true);

    const result = await generateFromDraft(adminA, draftId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("blocked");
    if (result.error !== "blocked") return;
    expect(result.blockers.some((b) => b.includes("99"))).toBe(true);

    const draft = await getDraft(adminA, draftId);
    expect(draft?.status).toBe("in_progress");
    expect(draft?.generatedCourseId).toBeNull();
  });

  it("módulo sin evaluación (se agrega un módulo DESPUÉS de fijar 'evaluaciones'): bloquea sin generar nada", async () => {
    const draftId = await seedSenceDraft(adminA, 2, 4); // m1, m2 — 8h
    const ev = await saveStep(adminA, draftId, "evaluaciones", {
      quizzes: [
        { moduleId: "m1", title: "Evaluación 1" },
        { moduleId: "m2", title: "Evaluación 2" },
      ],
      survey: { enabled: true, title: "Encuesta" },
    });
    expect(ev.ok).toBe(true);

    // Sube las horas del curso y agrega un TERCER módulo (m3) — la estructura
    // vuelve a validar (12 = 4+4+4) pero "evaluaciones" quedó desactualizado.
    await saveStep(adminA, draftId, "datos", {
      name: "Curso con módulo nuevo",
      modality: "elearning",
      hours: "12",
      sence: "true",
      codSence: "1234567890",
    });
    const estructura = await saveStep(adminA, draftId, "estructura", {
      modules: [{ title: "Módulo 1", hours: "4" }, { title: "Módulo 2", hours: "4" }, { title: "Módulo 3", hours: "4" }],
    });
    expect(estructura.ok).toBe(true);

    const result = await generateFromDraft(adminA, draftId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("blocked");
    if (result.error !== "blocked") return;
    expect(result.blockers.some((b) => b.includes("Módulo 3"))).toBe(true);

    const draft = await getDraft(adminA, draftId);
    expect(draft?.generatedCourseId).toBeNull();
  });
});

describe("wizard-service — descartar y aislamiento", () => {
  it("discardDraft nunca borra, solo marca 'discarded'; ya no se puede editar", async () => {
    const created = await createDraft(adminA, { source: "scratch" });
    if (!created.ok) throw new Error("no se creó");
    const discard = await discardDraft(adminA, created.draftId);
    expect(discard).toEqual({ ok: true });

    const draft = await getDraft(adminA, created.draftId);
    expect(draft?.status).toBe("discarded");

    const save = await saveStep(adminA, created.draftId, "datos", { name: "x" });
    expect(save).toEqual({ ok: false, error: "not_found" });
  });

  it("un draft de otro tenant no es visible ni editable (aislamiento)", async () => {
    const created = await createDraft(adminA, { source: "scratch" });
    if (!created.ok) throw new Error("no se creó");

    expect(await getDraft(adminB, created.draftId)).toBeNull();
    expect(await saveStep(adminB, created.draftId, "datos", { name: "hackeado" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect((await listDrafts(adminB)).some((d) => d.id === created.draftId)).toBe(false);
    expect((await listDrafts(adminA)).some((d) => d.id === created.draftId)).toBe(true);
  });
});

describe("wizard-service — flujo 'desde descriptor SENCE'", () => {
  it("createDraft procesa un .docx sintético y siembra el state con lo que el extractor encontró", async () => {
    const buffer = await buildDescriptorFixtureDocx(DESCRIPTOR_FIXTURE_LINES);
    const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const result = await createDraft(adminA, {
      source: "descriptor",
      file: { name: "descriptor de prueba.docx", type: DOCX_MIME, size: bytes.byteLength, bytes },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const draft = await getDraft(adminA, result.draftId);
    expect(draft?.source).toBe("descriptor");
    expect(draft?.descriptorName).toBe("descriptor de prueba.docx");
    expect(draft?.state.datosSeed.name).toBe("Manejo seguro de extintores");
    expect(draft?.state.datosSeed.hours).toBe(8);
    expect(draft?.state.estructura.modules.map((m) => m.title)).toEqual([
      "Introducción a los extintores",
      "Uso práctico en emergencia",
    ]);
    expect(draft?.state.estructura.modules.map((m) => m.hours)).toEqual([4, 4]);
    expect(draft?.state.outcomesSeed).toEqual([
      "Reconocer los tipos de extintores y su uso según la clase de fuego.",
      "Aplicar el protocolo de uso en una emergencia simulada.",
    ]);
    expect(draft?.state.extractWarnings).toEqual([]);

    // El descriptor queda ARCHIVADO junto al curso: se puede volver a descargar.
    const url = await descriptorDownloadUrl(adminA, result.draftId);
    expect(url.ok).toBe(true);
  });

  it("rechaza un archivo que no sea .docx", async () => {
    const bytes = new TextEncoder().encode("no soy un docx").buffer;
    const result = await createDraft(adminA, {
      source: "descriptor",
      file: { name: "archivo.txt", type: "text/plain", size: bytes.byteLength, bytes },
    });
    expect(result).toEqual({ ok: false, error: "file_rejected" });
  });

  it("rechaza un archivo que supera los 10 MB declarados", async () => {
    const result = await createDraft(adminA, {
      source: "descriptor",
      file: { name: "grande.docx", type: DOCX_MIME, size: 11 * 1024 * 1024, bytes: new ArrayBuffer(0) },
    });
    expect(result).toEqual({ ok: false, error: "file_rejected" });
  });
});
