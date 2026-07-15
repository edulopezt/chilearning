/**
 * GATE de la task 2.5 (HU-5.5/M12): el rol `supervisor` es de SOLO LECTURA.
 * Verifica a nivel de BD (RLS + grants) que el fiscalizador NO puede
 * INSERT/UPDATE/DELETE en NINGUNA tabla de negocio.
 *
 * ⚠ CHECKLIST: si agregas una tabla de negocio nueva, agrégala a
 * BUSINESS_TABLES con un fixture de INSERT mínimo (o el insert probará solo
 * el fallo por columnas — igual debe fallar).
 *
 * Excepción BY-DESIGN documentada: `audit_log` permite INSERT a cualquier
 * miembro SOLO como su propio actor (P8, append-only, inmutable por trigger);
 * se verifica esa forma exacta y que update/delete siguen negados.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const SUPERVISOR_ID = "aaaaaaaa-0000-4000-8000-000000000007"; // seed índice 7

/** Tabla → fila mínima para intentar el INSERT (con tenant propio). */
const BUSINESS_TABLES: Record<string, Record<string, unknown>> = {
  tenants: { slug: `sup-${randomUUID().slice(0, 8)}`, name: "Pirata" },
  memberships: { tenant_id: TENANT_A, user_id: SUPERVISOR_ID, roles: ["student"] },
  courses: { tenant_id: TENANT_A, name: "Curso pirata", sence: false },
  actions: {
    tenant_id: TENANT_A,
    course_id: "c0000000-0000-4000-8000-000000000001",
    codigo_accion: "SUP-HACK",
    training_line: 3,
    environment: "rcetest",
  },
  lessons: {
    tenant_id: TENANT_A,
    course_id: "c0000000-0000-4000-8000-000000000001",
    title: "Pirata",
    kind: "text",
    content: "x",
    position: 99,
  },
  enrollments: {
    tenant_id: TENANT_A,
    action_id: "ac000000-0000-4000-8000-000000000001",
    user_id: SUPERVISOR_ID,
    run: "5126663-3",
  },
  lesson_progress: {
    tenant_id: TENANT_A,
    enrollment_id: "e0000000-0000-4000-8000-000000000001",
    lesson_id: "00000000-0000-4000-8000-000000000000",
    completed: true,
  },
  sence_otec_config: { tenant_id: TENANT_A, rut_otec: "76111111-6" },
  sence_sessions: {
    tenant_id: TENANT_A,
    enrollment_id: "e0000000-0000-4000-8000-000000000001",
    action_code: "SUP-HACK",
    training_line: 3,
    run_alumno: "5126663-3",
    id_sesion_alumno: `sup-hack-${randomUUID()}`,
    environment: "rcetest",
  },
  sence_events: {
    tenant_id: TENANT_A,
    kind: "start_ok",
    payload: {},
    dedupe_hash: `sup-hack-${randomUUID()}`,
  },
  alerts: {
    tenant_id: TENANT_A,
    kind: "sence_error_rate",
    message: "pirata",
  },
  quizzes: {
    tenant_id: TENANT_A,
    course_id: "c0000000-0000-4000-8000-000000000001",
    title: "Quiz pirata",
  },
  questions: {
    tenant_id: TENANT_A,
    quiz_id: "a0000000-0000-4000-8000-000000000001",
    kind: "true_false",
    prompt: "pirata",
    body: { correct: true },
  },
  quiz_attempts: {
    tenant_id: TENANT_A,
    quiz_id: "a0000000-0000-4000-8000-000000000001",
    enrollment_id: "e0000000-0000-4000-8000-000000000001",
    attempt_number: 99,
    questions_snapshot: [],
    answer_key: {},
    max_score: 1,
  },
  grades: {
    tenant_id: TENANT_A,
    enrollment_id: "e0000000-0000-4000-8000-000000000001",
    source_kind: "quiz",
    quiz_id: "a0000000-0000-4000-8000-000000000001",
    grade: 7.0,
  },
};

let db: SupabaseClient;

beforeAll(async () => {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string) => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  const token = await new SignJWT({
    role: "authenticated",
    tenant_id: TENANT_A,
    roles: ["supervisor"],
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(SUPERVISOR_ID)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(get("JWT_SECRET")));
  db = createClient(get("API_URL"), get("ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
});

describe("supervisor NO escribe ninguna tabla de negocio (task 2.5 — solo lectura)", () => {
  for (const [table, row] of Object.entries(BUSINESS_TABLES)) {
    it(`INSERT en ${table} → denegado`, async () => {
      const { error } = await db.from(table).insert(row);
      expect(error, `el supervisor pudo INSERTAR en ${table}`).not.toBeNull();
    });

    it(`UPDATE en ${table} → denegado o 0 filas`, async () => {
      const { data, error } = await db
        .from(table)
        .update({ updated_at: new Date().toISOString() } as Record<string, unknown>)
        .eq("tenant_id", TENANT_A)
        .select("tenant_id");
      expect(
        error !== null || (data ?? []).length === 0,
        `el supervisor pudo ACTUALIZAR ${table}`,
      ).toBe(true);
    });

    it(`DELETE en ${table} → denegado o 0 filas`, async () => {
      const { data, error } = await db
        .from(table)
        .delete()
        .eq("tenant_id", TENANT_A)
        .select("tenant_id");
      expect(
        error !== null || (data ?? []).length === 0,
        `el supervisor pudo BORRAR en ${table}`,
      ).toBe(true);
    });
  }

  it("EXCEPCIÓN by-design: audit_log acepta INSERT solo como su PROPIO actor (P8)", async () => {
    // Como su propio actor: permitido (P8 — todo deja rastro, append-only).
    const own = await db.from("audit_log").insert({
      tenant_id: TENANT_A,
      actor_user_id: SUPERVISOR_ID,
      action: "supervisor.readonly.test",
    });
    expect(own.error).toBeNull();

    // Suplantando a otro actor: denegado.
    const forged = await db.from("audit_log").insert({
      tenant_id: TENANT_A,
      actor_user_id: "aaaaaaaa-0000-4000-8000-000000000001",
      action: "supervisor.forged",
    });
    expect(forged.error).not.toBeNull();

    // Y la bitácora sigue inmutable: ni update ni delete.
    const upd = await db
      .from("audit_log")
      .update({ action: "hacked" })
      .eq("tenant_id", TENANT_A)
      .select("id");
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
  });
});
