/**
 * RLS de la encuesta de satisfacción (task 3.1, HU-6.3): aislamiento por tenant,
 * el anonimato ESTRUCTURAL (survey_responses.enrollment_id NULL cuando es
 * anónima → el staff no mapea respuesta ↔ alumno), el alumno no lee respuestas,
 * y las tablas de respuestas/ledger son INSERT-only incluso para service_role.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const COURSE_A = "c0000000-0000-4000-8000-000000000001";
const ACTION_A = "ac000000-0000-4000-8000-000000000001";
const ENROLLMENT_A = "e0000000-0000-4000-8000-000000000001";
const STUDENT_A = "aaaaaaaa-0000-4000-8000-000000000005";

// UUID por corrida: la suite es idempotente aun sin `db reset` entre ejecuciones.
const SURVEY_ID = randomUUID();

interface LocalEnv {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  jwtSecret: string;
}

function loadLocalEnv(): LocalEnv {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (key: string): string => {
    const match = out.match(new RegExp(`^${key}="?([^"\\r\\n]+)"?$`, "m"));
    if (!match?.[1]) throw new Error(`supabase status no expone ${key}`);
    return match[1];
  };
  return {
    apiUrl: get("API_URL"),
    anonKey: get("ANON_KEY"),
    serviceRoleKey: get("SERVICE_ROLE_KEY"),
    jwtSecret: get("JWT_SECRET"),
  };
}

let env: LocalEnv;

async function jwt(claims: { sub: string; tenant_id?: string; roles: string[] }): Promise<string> {
  return new SignJWT({
    role: "authenticated",
    ...(claims.tenant_id ? { tenant_id: claims.tenant_id } : {}),
    roles: claims.roles,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.jwtSecret));
}

function client(token?: string): SupabaseClient {
  return createClient(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });
}

function serviceClient(): SupabaseClient {
  return createClient(env.apiUrl, env.serviceRoleKey, { auth: { persistSession: false } });
}

beforeAll(async () => {
  env = loadLocalEnv();
  const svc = serviceClient();

  const survey = await svc.from("surveys").insert({
    id: SURVEY_ID,
    tenant_id: TENANT_A,
    course_id: COURSE_A,
    title: "Encuesta RLS",
    anonymous: true,
    status: "published",
    questions: { questions: [{ id: "q1", type: "scale", label: "Satisfacción", required: true, scaleMax: 5 }] },
  });
  if (survey.error) throw new Error(`seed survey: ${survey.error.message}`);

  // Ledger de participación del alumno demo.
  const sub = await svc.from("survey_submissions").insert({
    tenant_id: TENANT_A,
    survey_id: SURVEY_ID,
    enrollment_id: ENROLLMENT_A,
  });
  if (sub.error) throw new Error(`seed submission: ${sub.error.message}`);

  // Respuesta ANÓNIMA: enrollment_id NULL (anonimato estructural).
  const resp = await svc.from("survey_responses").insert({
    tenant_id: TENANT_A,
    survey_id: SURVEY_ID,
    action_id: ACTION_A,
    enrollment_id: null,
    answers: { q1: 5 },
  });
  if (resp.error) throw new Error(`seed response: ${resp.error.message}`);
});

describe("surveys — lecturas por rol", () => {
  it("el staff (otec_admin/coordinator/instructor/tutor) del tenant A lee encuestas y respuestas", async () => {
    for (const role of ["otec_admin", "coordinator", "instructor", "tutor"]) {
      const c = client(await jwt({ sub: STUDENT_A, tenant_id: TENANT_A, roles: [role] }));
      const surveys = await c.from("surveys").select("id").eq("id", SURVEY_ID);
      expect(surveys.error).toBeNull();
      expect((surveys.data ?? []).length).toBe(1);
      const responses = await c.from("survey_responses").select("id, enrollment_id").eq("survey_id", SURVEY_ID);
      expect(responses.error).toBeNull();
      expect((responses.data ?? []).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("ANONIMATO: la respuesta anónima tiene enrollment_id NULL — el staff no la mapea a un alumno", async () => {
    const c = client(await jwt({ sub: "aaaaaaaa-0000-4000-8000-000000000001", tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const { data } = await c.from("survey_responses").select("enrollment_id").eq("survey_id", SURVEY_ID);
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
    for (const row of (data ?? []) as { enrollment_id: string | null }[]) {
      expect(row.enrollment_id).toBeNull();
    }
  });

  it("el alumno lee la encuesta publicada y SU participación, pero NO las respuestas", async () => {
    const c = client(await jwt({ sub: STUDENT_A, tenant_id: TENANT_A, roles: ["student"] }));

    const survey = await c.from("surveys").select("id").eq("id", SURVEY_ID);
    expect((survey.data ?? []).length).toBe(1);

    const sub = await c.from("survey_submissions").select("id").eq("survey_id", SURVEY_ID);
    expect((sub.data ?? []).length).toBe(1);

    const responses = await c.from("survey_responses").select("id").eq("survey_id", SURVEY_ID);
    expect(responses.data ?? []).toHaveLength(0);
  });

  it("el otec_admin del tenant B NO ve la encuesta del tenant A (aislamiento)", async () => {
    const c = client(await jwt({ sub: "bbbbbbbb-0000-4000-8000-000000000001", tenant_id: TENANT_B, roles: ["otec_admin"] }));
    const surveys = await c.from("surveys").select("id").eq("id", SURVEY_ID);
    expect(surveys.data ?? []).toHaveLength(0);
    const responses = await c.from("survey_responses").select("id").eq("survey_id", SURVEY_ID);
    expect(responses.data ?? []).toHaveLength(0);
  });

  it("una encuesta en BORRADOR no es visible para el alumno", async () => {
    const svc = serviceClient();
    const draftId = randomUUID();
    await svc.from("surveys").insert({
      id: draftId, tenant_id: TENANT_A, course_id: COURSE_A, title: "Borrador", status: "draft",
      questions: { questions: [] },
    });
    const c = client(await jwt({ sub: STUDENT_A, tenant_id: TENANT_A, roles: ["student"] }));
    const { data } = await c.from("surveys").select("id").eq("id", draftId);
    expect(data ?? []).toHaveLength(0);
  });
});

describe("surveys — el cliente no escribe; respuestas/ledger inmutables", () => {
  it("el otec_admin no inserta encuestas (solo el servidor)", async () => {
    const c = client(await jwt({ sub: "aaaaaaaa-0000-4000-8000-000000000001", tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const ins = await c.from("surveys").insert({ tenant_id: TENANT_A, course_id: COURSE_A, title: "hack", questions: { questions: [] } });
    expect(ins.error).not.toBeNull();
  });

  it("ni service_role puede UPDATE/DELETE respuestas o ledger (INSERT-only)", async () => {
    const svc = serviceClient();
    const upd = await svc.from("survey_responses").update({ answers: { q1: 1 } }).eq("survey_id", SURVEY_ID).select("id");
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
    const del = await svc.from("survey_submissions").delete().eq("survey_id", SURVEY_ID).select("id");
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);
  });
});
