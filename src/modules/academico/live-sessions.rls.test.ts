/**
 * RLS de sincrónico en vivo (task 5.4, spec §7-R3): el alumno inscrito en la
 * acción de la sesión la ve; un alumno del MISMO tenant inscrito en OTRA
 * acción NO la ve (caso adversarial clave); el tenant B no ve nada; el
 * cliente NUNCA escribe directo (sin grant a `authenticated`); un alumno no
 * lee la asistencia de OTRO alumno de la misma acción.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const COURSE_A = "c0000000-0000-4000-8000-000000000001";
const ACTION_A1 = "ac000000-0000-4000-8000-000000000001"; // acción demo sembrada

const OTEC_ADMIN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TUTOR_A = "aaaaaaaa-0000-4000-8000-000000000004";
const STUDENT_A1 = "aaaaaaaa-0000-4000-8000-000000000005"; // enrollment e0000000...001, acción A1
const RODRIGO_A1 = "aaaaaaaa-0000-4000-8000-000000000008"; // enrollment e0000000...002, MISMA acción A1
const OTHER_ACTION_USER = "aaaaaaaa-0000-4000-8000-000000000006"; // se inscribe en ACTION_A2 (otra acción del MISMO tenant)
const SUPERVISOR_A = "aaaaaaaa-0000-4000-8000-000000000007"; // grant tenant-wide sembrado

const ENROLLMENT_STUDENT_A1 = "e0000000-0000-4000-8000-000000000001";
const ENROLLMENT_RODRIGO_A1 = "e0000000-0000-4000-8000-000000000002";

const ACTION_A2 = randomUUID(); // OTRA acción del mismo tenant A (caso adversarial)
const ENROLLMENT_OTHER_ACTION = randomUUID();
const SESSION_1 = randomUUID(); // sesión en ACTION_A1
const ATTEND_1 = randomUUID(); // asistencia de STUDENT_A1 en SESSION_1

interface LocalEnv {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  jwtSecret: string;
}
function loadLocalEnv(): LocalEnv {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => {
    const m = out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"));
    if (!m?.[1]) throw new Error(`no ${k}`);
    return m[1];
  };
  return { apiUrl: get("API_URL"), anonKey: get("ANON_KEY"), serviceRoleKey: get("SERVICE_ROLE_KEY"), jwtSecret: get("JWT_SECRET") };
}
let env: LocalEnv;

async function jwt(c: { sub: string; tenant_id?: string; roles: string[] }): Promise<string> {
  return new SignJWT({ role: "authenticated", ...(c.tenant_id ? { tenant_id: c.tenant_id } : {}), roles: c.roles })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(c.sub)
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
function svcClient(): SupabaseClient {
  return createClient(env.apiUrl, env.serviceRoleKey, { auth: { persistSession: false } });
}

beforeAll(async () => {
  env = loadLocalEnv();
  const svc = svcClient();

  // Otra acción del MISMO tenant (adversarial: enrollment ahí NO debe ver
  // las sesiones de ACTION_A1).
  const action = await svc.from("actions").insert({
    id: ACTION_A2,
    tenant_id: TENANT_A,
    course_id: COURSE_A,
    codigo_accion: `RLS-LIVE-${ACTION_A2.slice(0, 8)}`,
    training_line: 3,
    environment: "rcetest",
  });
  if (action.error) throw new Error(`seed action A2: ${action.error.message}`);

  const enr = await svc.from("enrollments").insert({
    id: ENROLLMENT_OTHER_ACTION,
    tenant_id: TENANT_A,
    action_id: ACTION_A2,
    user_id: OTHER_ACTION_USER,
    run: "9999999-9",
    first_names: "Otra Acción",
    last_names: "Alumno Ficticio",
  });
  if (enr.error) throw new Error(`seed enrollment other action: ${enr.error.message}`);

  const session = await svc.from("live_sessions").insert({
    id: SESSION_1,
    tenant_id: TENANT_A,
    action_id: ACTION_A1,
    title: "Clase en vivo de prueba RLS",
    provider: "zoom",
    meeting_url: "https://zoom.us/j/000000000",
    starts_at: "2026-08-01T15:00:00Z",
    ends_at: "2026-08-01T16:00:00Z",
    created_by: OTEC_ADMIN_A,
  });
  if (session.error) throw new Error(`seed session: ${session.error.message}`);

  const attendance = await svc.from("live_session_attendance").insert({
    id: ATTEND_1,
    tenant_id: TENANT_A,
    session_id: SESSION_1,
    enrollment_id: ENROLLMENT_STUDENT_A1,
    present: true,
    source: "manual",
    marked_by: OTEC_ADMIN_A,
  });
  if (attendance.error) throw new Error(`seed attendance: ${attendance.error.message}`);
});

afterAll(async () => {
  const svc = svcClient();
  await svc.from("live_session_attendance").delete().eq("id", ATTEND_1);
  await svc.from("live_sessions").delete().eq("id", SESSION_1);
  await svc.from("enrollments").delete().eq("id", ENROLLMENT_OTHER_ACTION);
  await svc.from("actions").delete().eq("id", ACTION_A2);
});

describe("live_sessions — lecturas por rol", () => {
  it("el alumno inscrito en la acción de la sesión SÍ la ve", async () => {
    const c = client(await jwt({ sub: STUDENT_A1, tenant_id: TENANT_A, roles: ["student"] }));
    const { data, error } = await c.from("live_sessions").select("id").eq("id", SESSION_1);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: SESSION_1 }]);
  });

  it("ADVERSARIAL: un alumno del MISMO tenant inscrito en OTRA acción NO ve la sesión", async () => {
    const c = client(await jwt({ sub: OTHER_ACTION_USER, tenant_id: TENANT_A, roles: ["student"] }));
    const { data, error } = await c.from("live_sessions").select("id").eq("id", SESSION_1);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("staff del tenant (otec_admin) ve la sesión", async () => {
    const c = client(await jwt({ sub: OTEC_ADMIN_A, tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const { data, error } = await c.from("live_sessions").select("id").eq("id", SESSION_1);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: SESSION_1 }]);
  });

  it("tutor del tenant ve la sesión (lectura de staff)", async () => {
    const c = client(await jwt({ sub: TUTOR_A, tenant_id: TENANT_A, roles: ["tutor"] }));
    const { data, error } = await c.from("live_sessions").select("id").eq("id", SESSION_1);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: SESSION_1 }]);
  });

  it("supervisor con grant tenant-wide vigente ve la sesión", async () => {
    const c = client(await jwt({ sub: SUPERVISOR_A, tenant_id: TENANT_A, roles: ["supervisor"] }));
    const { data, error } = await c.from("live_sessions").select("id").eq("id", SESSION_1);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: SESSION_1 }]);
  });

  it("el tenant B no ve NADA (aislamiento)", async () => {
    const c = client(await jwt({ sub: "bbbbbbbb-0000-4000-8000-000000000001", tenant_id: TENANT_B, roles: ["otec_admin"] }));
    const { data, error } = await c.from("live_sessions").select("id").eq("id", SESSION_1);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe("live_session_attendance — lecturas por rol", () => {
  it("el propio alumno ve SU asistencia", async () => {
    const c = client(await jwt({ sub: STUDENT_A1, tenant_id: TENANT_A, roles: ["student"] }));
    const { data, error } = await c.from("live_session_attendance").select("id").eq("id", ATTEND_1);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: ATTEND_1 }]);
  });

  it("ADVERSARIAL: otro alumno de la MISMA acción no ve la asistencia ajena", async () => {
    const c = client(await jwt({ sub: RODRIGO_A1, tenant_id: TENANT_A, roles: ["student"] }));
    expect(ENROLLMENT_RODRIGO_A1).not.toBe(ENROLLMENT_STUDENT_A1); // guarda contra un typo de fixture
    const { data, error } = await c.from("live_session_attendance").select("id").eq("id", ATTEND_1);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("staff del tenant ve la asistencia", async () => {
    const c = client(await jwt({ sub: OTEC_ADMIN_A, tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const { data, error } = await c.from("live_session_attendance").select("id").eq("id", ATTEND_1);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: ATTEND_1 }]);
  });

  it("el tenant B no ve NADA", async () => {
    const c = client(await jwt({ sub: "bbbbbbbb-0000-4000-8000-000000000005", tenant_id: TENANT_B, roles: ["student"] }));
    const { data, error } = await c.from("live_session_attendance").select("id").eq("id", ATTEND_1);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe("el cliente NUNCA escribe directo (sin grant a authenticated)", () => {
  it("un alumno no puede insertar una live_session", async () => {
    const c = client(await jwt({ sub: STUDENT_A1, tenant_id: TENANT_A, roles: ["student"] }));
    const { error } = await c.from("live_sessions").insert({
      tenant_id: TENANT_A,
      action_id: ACTION_A1,
      title: "hack",
      provider: "zoom",
      meeting_url: "https://evil.example/x",
      starts_at: "2026-08-01T15:00:00Z",
      ends_at: "2026-08-01T16:00:00Z",
      created_by: STUDENT_A1,
    });
    expect(error).not.toBeNull();
  });

  it("un otec_admin (autenticado, no service-role) tampoco puede insertar directo", async () => {
    const c = client(await jwt({ sub: OTEC_ADMIN_A, tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const { error } = await c.from("live_sessions").insert({
      tenant_id: TENANT_A,
      action_id: ACTION_A1,
      title: "hack",
      provider: "zoom",
      meeting_url: "https://evil.example/x",
      starts_at: "2026-08-01T15:00:00Z",
      ends_at: "2026-08-01T16:00:00Z",
      created_by: OTEC_ADMIN_A,
    });
    expect(error).not.toBeNull();
  });

  it("un alumno no puede insertar una live_session_attendance (auto-marcarse por PostgREST directo)", async () => {
    const c = client(await jwt({ sub: STUDENT_A1, tenant_id: TENANT_A, roles: ["student"] }));
    const { error } = await c.from("live_session_attendance").insert({
      tenant_id: TENANT_A,
      session_id: SESSION_1,
      enrollment_id: ENROLLMENT_STUDENT_A1,
      present: true,
      source: "self",
      marked_by: STUDENT_A1,
    });
    expect(error).not.toBeNull();
  });

  it("nadie autenticado puede DELETE live_session_attendance (ni siquiera otec_admin: sin grant)", async () => {
    const c = client(await jwt({ sub: OTEC_ADMIN_A, tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const { error } = await c.from("live_session_attendance").delete().eq("id", ATTEND_1);
    expect(error).not.toBeNull();
  });
});
