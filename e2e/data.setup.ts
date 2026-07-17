import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { test as setup, expect } from "@playwright/test";

import { CERT, SCORM, SURVEY, TENANT_A } from "./roles";

/**
 * Siembra de datos para los flujos E2E (task 3.8) vía service-role. Idempotente:
 * el certificado usa un token fijo con upsert (ignora si ya existe). Requiere el
 * env de Supabase local (lo pone el runner). El alumno semilla es `...5`.
 */

setup("seed certificate for public verification", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  expect(url && key, "faltó el env de Supabase local").toBeTruthy();
  const db = createClient(url!, key!, { auth: { persistSession: false } });

  const courseId = randomUUID();
  const actionId = randomUUID();
  const enrollmentId = randomUUID();
  const student = "aaaaaaaa-0000-4000-8000-000000000005";

  await db.from("courses").upsert({ id: courseId, tenant_id: TENANT_A, name: CERT.courseName, sence: true, cod_sence: "1234567890" });
  await db.from("actions").upsert({ id: actionId, tenant_id: TENANT_A, course_id: courseId, codigo_accion: `E2E-${randomUUID().slice(0, 6)}`, training_line: 3, environment: "rcetest", starts_on: "2026-06-01", ends_on: "2026-06-30" });
  await db.from("enrollments").upsert({ id: enrollmentId, tenant_id: TENANT_A, action_id: actionId, user_id: student, run: CERT.runFull, first_names: "Ana E2E", last_names: "Pérez" });

  // Encuesta publicada para el flujo del alumno (#1): una pregunta de escala.
  const survey = await db.from("surveys").upsert(
    {
      id: SURVEY.id,
      tenant_id: TENANT_A,
      course_id: courseId,
      title: SURVEY.title,
      anonymous: true,
      status: "published",
      questions: { questions: [{ id: SURVEY.questionId, type: "scale", label: "¿Recomendarías el curso?", required: true, scaleMax: 5 }] },
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  expect(survey.error, survey.error?.message).toBeNull();

  const snapshot = {
    studentName: CERT.studentName,
    runMasked: CERT.runMasked,
    courseName: CERT.courseName,
    hours: 24,
    startsOn: "2026-06-01",
    endsOn: "2026-06-30",
    otecName: "Seminarea SpA",
  };
  const { error } = await db.from("certificates").upsert(
    {
      tenant_id: TENANT_A,
      enrollment_id: enrollmentId,
      action_id: actionId,
      course_id: courseId,
      folio: CERT.folio,
      verification_token: CERT.token,
      status: "issued",
      is_sence: true,
      snapshot,
    },
    { onConflict: "verification_token", ignoreDuplicates: true },
  );
  expect(error, error?.message).toBeNull();
});

/**
 * Seed del reproductor SCORM (task 5.1b, HU-4.2, ADR-006): paquete `ready` con
 * UN asset real subido directo a Storage (sin pasar por el worker de
 * extracción — no es su unidad de prueba) + lección publicada + inscripción
 * SIN candado (attendance_lock=false) para que el smoke no dependa de SENCE.
 * IDs fijos + upsert: idempotente entre corridas del harness.
 */
setup("seed scorm package + lesson for the player smoke test", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  expect(url && key, "faltó el env de Supabase local").toBeTruthy();
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  const student = "aaaaaaaa-0000-4000-8000-000000000005";

  await db.from("courses").upsert({ id: SCORM.courseId, tenant_id: TENANT_A, name: "Curso E2E SCORM" });
  await db.from("actions").upsert({
    id: SCORM.actionId,
    tenant_id: TENANT_A,
    course_id: SCORM.courseId,
    codigo_accion: "E2E-SCORM-0001",
    training_line: 3,
    environment: "rcetest",
    attendance_lock: false,
  });
  await db.from("enrollments").upsert({
    id: SCORM.enrollmentId,
    tenant_id: TENANT_A,
    action_id: SCORM.actionId,
    user_id: student,
    run: CERT.runFull,
    first_names: "Ana E2E",
    last_names: "Pérez",
  });

  const extractedPrefix = `${TENANT_A}/${SCORM.packageId}/ext`;
  const indexHtml = "<!doctype html><html><body><p>SCORM E2E fixture (100% ficticio)</p></body></html>";
  const upload = await db.storage
    .from("scorm")
    .upload(`${extractedPrefix}/index.html`, Buffer.from(indexHtml, "utf8"), {
      contentType: "text/html",
      upsert: true,
    });
  expect(upload.error, upload.error?.message).toBeNull();

  const pkg = await db.from("scorm_packages").upsert({
    id: SCORM.packageId,
    tenant_id: TENANT_A,
    course_id: SCORM.courseId,
    title: "Paquete E2E SCORM",
    status: "ready",
    scorm_version: "1.2",
    zip_path: `${TENANT_A}/${SCORM.packageId}/package.zip`,
    extracted_prefix: extractedPrefix,
    entry_href: "index.html",
    uploaded_by: student,
    file_size: 1000,
  });
  expect(pkg.error, pkg.error?.message).toBeNull();

  const lesson = await db.from("lessons").upsert({
    id: SCORM.lessonId,
    tenant_id: TENANT_A,
    course_id: SCORM.courseId,
    title: "Lección E2E SCORM",
    kind: "scorm",
    content: SCORM.packageId,
    position: 1,
    status: "published",
  });
  expect(lesson.error, lesson.error?.message).toBeNull();
});
