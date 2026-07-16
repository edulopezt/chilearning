import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { test as setup, expect } from "@playwright/test";

import { CERT, TENANT_A } from "./roles";

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

  const snapshot = {
    studentName: CERT.studentName,
    runMasked: CERT.runMasked,
    courseName: CERT.courseName,
    hours: 24,
    startsOn: "2026-06-01",
    endsOn: "2026-06-30",
    otecName: "OTEC Demo Andes SpA",
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
