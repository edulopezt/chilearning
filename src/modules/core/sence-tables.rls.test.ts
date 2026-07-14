/**
 * RLS de las tablas del motor SENCE (task 0.7): sence_sessions y sence_events.
 * Verifica aislamiento por tenant, que el cliente NO puede escribir (solo el
 * servidor vía service_role) y que sence_events es INSERT-only incluso para el
 * service role. Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

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
  return createClient(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false },
  });
}

const DEMO_COURSE = "c0000000-0000-4000-8000-000000000001";
const STUDENT_A = "aaaaaaaa-0000-4000-8000-000000000005";

/** Crea una inscripción REAL (acción + enrollment) para satisfacer el FK
 *  enrollment_id → enrollments; devuelve el id de la inscripción. */
async function nextEnrollment(): Promise<string> {
  const svc = serviceClient();
  const actionId = randomUUID();
  await svc.from("actions").insert({
    id: actionId,
    tenant_id: TENANT_A,
    course_id: DEMO_COURSE,
    codigo_accion: "ACC-RLS-TEST",
    training_line: 3,
    environment: "rcetest",
  });
  const enrollmentId = randomUUID();
  await svc.from("enrollments").insert({
    id: enrollmentId,
    tenant_id: TENANT_A,
    action_id: actionId,
    user_id: STUDENT_A,
    run: "5126663-3",
  });
  return enrollmentId;
}

/** El servidor (service_role) siembra una sesión, como haría el motor real. */
async function seedSession(): Promise<string> {
  const svc = serviceClient();
  const enrollmentId = await nextEnrollment();
  const idSesionAlumno = `test-${randomUUID()}`;
  const { data, error } = await svc
    .from("sence_sessions")
    .insert({
      tenant_id: TENANT_A,
      enrollment_id: enrollmentId,
      action_code: "RLAB-19-02-08-0071",
      training_line: 3,
      run_alumno: "5126663-3",
      id_sesion_alumno: idSesionAlumno,
      environment: "rcetest",
    })
    .select("id")
    .single();
  if (error) throw new Error(`no se pudo sembrar sesión: ${error.message}`);
  return data.id as string;
}

beforeAll(() => {
  env = loadLocalEnv();
});

describe("sence_sessions — aislamiento y no-escritura desde el cliente", () => {
  it("otec_admin@A no lee sesiones del tenant B", async () => {
    await seedSession();
    const db = client(await jwt({ sub: "u", tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const { data, error } = await db.from("sence_sessions").select("tenant_id");
    expect(error).toBeNull();
    expect(data?.every((r) => r.tenant_id === TENANT_A)).toBe(true);
    expect(data?.length).toBeGreaterThan(0);
  });

  it("otec_admin@B no ve las sesiones del tenant A", async () => {
    const db = client(await jwt({ sub: "u", tenant_id: TENANT_B, roles: ["otec_admin"] }));
    const { data, error } = await db.from("sence_sessions").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("el cliente NO puede insertar sesiones (solo el servidor)", async () => {
    const db = client(await jwt({ sub: "u", tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const { error } = await db.from("sence_sessions").insert({
      tenant_id: TENANT_A,
      // El insert falla por falta de grant (cliente) antes de tocar el FK.
      enrollment_id: randomUUID(),
      action_code: "X",
      training_line: 3,
      run_alumno: "5126663-3",
      id_sesion_alumno: "hacked",
      environment: "rcetest",
    });
    expect(error).not.toBeNull();
  });

  it("la línea 1 exige CodSence vacío (constraint del contrato I-10)", async () => {
    const svc = serviceClient();
    // Inscripción real para que falle la CHECK de línea 1, no el FK.
    const enrollmentId = await nextEnrollment();
    const { error } = await svc.from("sence_sessions").insert({
      tenant_id: TENANT_A,
      enrollment_id: enrollmentId,
      sence_course_code: "1234567890",
      action_code: "RLAB-19-02-08-0071-1",
      training_line: 1,
      run_alumno: "5126663-3",
      id_sesion_alumno: `l1-${randomUUID()}`,
      environment: "rcetest",
    });
    expect(error).not.toBeNull();
  });
});

describe("sence_events — INSERT-only y sin token (I-2, I-7)", () => {
  it("el service role puede insertar un evento, pero NO actualizarlo ni borrarlo", async () => {
    const sessionId = await seedSession();
    const svc = serviceClient();
    const dedupe = `dh-${randomUUID()}`;
    const inserted = await svc.from("sence_events").insert({
      tenant_id: TENANT_A,
      session_id: sessionId,
      kind: "start_ok",
      payload: { RunAlumno: "5126663-3", IdSesionSence: "S-123" },
      dedupe_hash: dedupe,
    });
    expect(inserted.error).toBeNull();

    const updated = await svc
      .from("sence_events")
      .update({ kind: "unmatched" })
      .eq("dedupe_hash", dedupe);
    expect(updated.error).not.toBeNull();

    const deleted = await svc.from("sence_events").delete().eq("dedupe_hash", dedupe);
    expect(deleted.error).not.toBeNull();
  });

  it("rechaza persistir un payload que contenga el Token (I-7)", async () => {
    const sessionId = await seedSession();
    const svc = serviceClient();
    const withToken = await svc.from("sence_events").insert({
      tenant_id: TENANT_A,
      session_id: sessionId,
      kind: "start_ok",
      payload: { RunAlumno: "5126663-3", Token: "no-debe-persistirse" },
      dedupe_hash: `tok-${randomUUID()}`,
    });
    expect(withToken.error).not.toBeNull();
  });

  it("I-1: dos eventos con el mismo dedupe_hash SÍ persisten (el índice no es único)", async () => {
    // Tras el hallazgo C-1: un replay legítimo debe persistir un 2º evento (I-1);
    // la idempotencia de la TRANSICIÓN la da la máquina de estados, no la BD.
    const sessionId = await seedSession();
    const svc = serviceClient();
    const dedupe = `idem-${randomUUID()}`;
    const row = { tenant_id: TENANT_A, session_id: sessionId, kind: "start_ok" as const, payload: { RunAlumno: "5126663-3" }, dedupe_hash: dedupe };
    const first = await svc.from("sence_events").insert(row);
    const second = await svc.from("sence_events").insert(row);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull(); // ambos se persisten (I-1)
    const { count } = await svc
      .from("sence_events")
      .select("*", { count: "exact", head: true })
      .eq("dedupe_hash", dedupe);
    expect(count).toBe(2);
  });

  it("student@A no puede leer la bitácora de eventos (solo admin/supervisor)", async () => {
    const db = client(await jwt({ sub: "u", tenant_id: TENANT_A, roles: ["student"] }));
    const { data, error } = await db.from("sence_events").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
