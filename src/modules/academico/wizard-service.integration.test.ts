/**
 * Integración del asistente de creación de cursos (task 5.10, HU-3.5/4.5):
 * flujo "desde cero" de punta a punta, los bloqueos de `validateForGeneration`
 * cuando el estado queda incoherente entre pasos, la idempotencia de
 * `generateFromDraft` y el flujo "desde descriptor SENCE" (.docx sintético).
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { listCourses } from "@/modules/academico/course-service";
import { listLessons } from "@/modules/academico/lesson-service";
import type { Principal } from "@/modules/core/domain/rbac";
import { listQuizzesByCourse } from "@/modules/evaluacion/quiz-service";
import { listSurveysByCourse } from "@/modules/evaluacion/survey-service";
import {
  buildDescriptorFixtureDocx,
  buildDescriptorZipBombFixture,
  DESCRIPTOR_FIXTURE_LINES,
} from "./testing/descriptor-fixture";
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

describe("generateFromDraft — idempotencia real ante condiciones de carrera (4-ojos HIGH)", () => {
  it("dos llamadas CONCURRENTES al mismo draft generan UN solo curso real — la perdedora hace rollback de su huérfano", async () => {
    // El bug original: el chequeo inicial (`generated_course_id` null) y el
    // enlace posterior son dos round-trips SEPARADOS; sin el UPDATE
    // condicional + rollback, dos llamadas que leen null ANTES de que
    // cualquiera escriba crean cada una su PROPIO curso real (duplicado). Se
    // fuerza la carrera con `Promise.all` real (dos requests HTTP
    // concurrentes contra el Supabase local), no con mocks.
    const uniqueName = `Curso concurrencia ${randomUUID()}`;
    const created = await createDraft(adminA, { source: "scratch" });
    if (!created.ok) throw new Error("no se creó el draft");
    const draftId = created.draftId;

    const datos = await saveStep(adminA, draftId, "datos", {
      name: uniqueName,
      modality: "elearning",
      hours: "2",
      sence: "true",
      codSence: "1234567890",
    });
    if (!datos.ok) throw new Error(`paso datos inválido: ${JSON.stringify(datos)}`);
    const estructura = await saveStep(adminA, draftId, "estructura", { modules: [{ title: "Módulo 1", hours: "2" }] });
    if (!estructura.ok) throw new Error(`paso estructura inválido: ${JSON.stringify(estructura)}`);
    const evaluaciones = await saveStep(adminA, draftId, "evaluaciones", {
      quizzes: [{ moduleId: "m1", title: "Evaluación única" }],
      survey: { enabled: true, title: "Encuesta" },
    });
    if (!evaluaciones.ok) throw new Error(`paso evaluaciones inválido: ${JSON.stringify(evaluaciones)}`);
    const completitud = await saveStep(adminA, draftId, "completitud", { requireSurvey: "on" });
    if (!completitud.ok) throw new Error(`paso completitud inválido: ${JSON.stringify(completitud)}`);

    const [r1, r2] = await Promise.all([generateFromDraft(adminA, draftId), generateFromDraft(adminA, draftId)]);
    const results = [r1, r2];
    const succeeded = results.filter((r) => r.ok);
    const rejected = results.filter((r) => !r.ok);

    // Exactamente UNA gana; la otra se rechaza por `already_generated` (no
    // por un error genérico) — el rollback re-lee el draft y detecta que la
    // ganadora ya lo enlazó.
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const winner = succeeded[0]!;
    const loser = rejected[0]!;
    if (!winner.ok || loser.ok) throw new Error("unreachable");
    expect(loser.error).toBe("already_generated");

    const draft = await getDraft(adminA, draftId);
    expect(draft?.status).toBe("generated");
    expect(draft?.generatedCourseId).toBe(winner.courseId);

    // Fila REAL en `courses`: ni un curso huérfano de la perdedora quedó
    // colgando (se hizo rollback), ni se creó una segunda fila para el mismo
    // draft — exactamente UNA, la de la ganadora.
    const courses = await listCourses(adminA);
    const matches = courses.filter((c) => c.name === uniqueName);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe(winner.courseId);

    // Y su contenido tampoco se duplicó (1 lección-cabecera + 1 evaluación).
    expect(await listLessons(adminA, winner.courseId)).toHaveLength(1);
    expect(await listQuizzesByCourse(adminA, winner.courseId)).toHaveLength(1);
  });
});

describe("wizard-service — estabilidad de ids de módulo al reeditar 'estructura' (4-ojos MED)", () => {
  it("reordenar módulos PRESERVANDO sus ids explícitos (como hace la UI corregida) no reasigna aprendizajes/lecciones/evaluaciones ya cargados", async () => {
    const draftId = await seedSenceDraft(adminA, 2, 4); // m1 "Módulo 1" 4h, m2 "Módulo 2" 4h

    await saveStep(adminA, draftId, "aprendizajes", { m1: "Aprendizaje de M1", m2: "Aprendizaje de M2" });
    const contenido = await saveStep(adminA, draftId, "contenido", {
      lessons: [
        { moduleId: "m1", title: "Lección de M1", kind: "text", content: "contenido m1" },
        { moduleId: "m2", title: "Lección de M2", kind: "text", content: "contenido m2" },
      ],
    });
    expect(contenido.ok).toBe(true);
    const evaluaciones = await saveStep(adminA, draftId, "evaluaciones", {
      quizzes: [
        { moduleId: "m1", title: "Eval M1" },
        { moduleId: "m2", title: "Eval M2" },
      ],
      survey: { enabled: true, title: "Encuesta" },
    });
    expect(evaluaciones.ok).toBe(true);
    await saveStep(adminA, draftId, "completitud", { requireSurvey: "on" });

    // Reabre "estructura" e INVIERTE el orden de las líneas, PRESERVANDO los
    // ids ("id | título | horas") — así reenvía la textarea la UI corregida
    // (`EstructuraStepForm`/`parseModulesTextarea`) tras el fix.
    const swap = await saveStep(adminA, draftId, "estructura", {
      modules: [
        { id: "m2", title: "Módulo 2", hours: "4" },
        { id: "m1", title: "Módulo 1", hours: "4" },
      ],
    });
    expect(swap.ok).toBe(true);

    const result = await generateFromDraft(adminA, draftId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // El bucle de generación recorre `estructura.modules` en su orden ACTUAL
    // (m2 primero tras el swap): la cabecera+lección de M2 deben traer SU
    // aprendizaje/contenido — no el de M1 (que quedaría mal atribuido si el
    // id se hubiera reasignado por posición en vez de preservarse).
    const lessons = await listLessons(adminA, result.courseId);
    expect(lessons.map((l) => l.title)).toEqual([
      "Módulo 1 — Módulo 2",
      "Lección de M2",
      "Módulo 2 — Módulo 1",
      "Lección de M1",
    ]);
    expect(lessons[0]?.content).toContain("Aprendizaje de M2");
    expect(lessons[2]?.content).toContain("Aprendizaje de M1");

    const quizzes = await listQuizzesByCourse(adminA, result.courseId);
    expect(quizzes.map((q) => q.title).sort()).toEqual(["Eval M1", "Eval M2"]);
  });

  it("borrar un módulo con contenido/evaluaciones/aprendizajes ya cargados bloquea la generación (no los descarta/misatribuye en silencio)", async () => {
    const draftId = await seedSenceDraft(adminA, 2, 4); // m1, m2 — 8h

    await saveStep(adminA, draftId, "aprendizajes", { m1: "Aprendizaje de M1", m2: "Aprendizaje de M2" });
    await saveStep(adminA, draftId, "contenido", {
      lessons: [{ moduleId: "m2", title: "Lección de M2", kind: "text", content: "contenido m2" }],
    });
    await saveStep(adminA, draftId, "evaluaciones", {
      quizzes: [
        { moduleId: "m1", title: "Eval M1" },
        { moduleId: "m2", title: "Eval M2" },
      ],
      survey: { enabled: true, title: "Encuesta" },
    });
    await saveStep(adminA, draftId, "completitud", { requireSurvey: "on" });

    // Vuelve a "estructura", BAJA las horas del curso y BORRA m2 (solo queda
    // m1) — las referencias a "m2" en aprendizajes/contenido/evaluaciones
    // quedan huérfanas.
    await saveStep(adminA, draftId, "datos", {
      name: "Curso con módulo borrado",
      modality: "elearning",
      hours: "4",
      sence: "true",
      codSence: "1234567890",
    });
    const estructura = await saveStep(adminA, draftId, "estructura", {
      modules: [{ id: "m1", title: "Módulo 1", hours: "4" }],
    });
    expect(estructura.ok).toBe(true);

    const result = await generateFromDraft(adminA, draftId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("blocked");
    if (result.error !== "blocked") return;
    expect(result.blockers.some((b) => b.includes("m2") && b.includes("lecciones"))).toBe(true);
    expect(result.blockers.some((b) => b.includes("m2") && b.includes("evaluaciones"))).toBe(true);
    expect(result.blockers.some((b) => b.includes("m2") && b.includes("aprendizajes"))).toBe(true);

    // Nada se generó: ni curso ni contenido.
    const draft = await getDraft(adminA, draftId);
    expect(draft?.generatedCourseId).toBeNull();
    expect(draft?.status).toBe("in_progress");
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

  it("rechaza un .docx que declara un tamaño descomprimido enorme (guardia anti zip-bomb, 4-ojos HIGH/MED)", async () => {
    // "A".repeat(60 MB) con DEFLATE comprime a apenas unos KB (pasa de sobra
    // el límite de 10 MB COMPRIMIDOS), pero declara honestamente 60 MB
    // descomprimidos en el directorio central del .zip — por encima del
    // presupuesto de `MAX_DESCRIPTOR_UNCOMPRESSED_BYTES` (50 MB).
    const buffer = await buildDescriptorZipBombFixture(60 * 1024 * 1024);
    const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    expect(bytes.byteLength).toBeLessThan(10 * 1024 * 1024); // pasa el chequeo de tamaño COMPRIMIDO

    const result = await createDraft(adminA, {
      source: "descriptor",
      file: { name: "bomba.docx", type: DOCX_MIME, size: bytes.byteLength, bytes },
    });
    expect(result).toEqual({ ok: false, error: "file_rejected" });
  });
});
