/**
 * RLS del esquema del Tutor IA (task 5.8a, HU-11.3, ADR-007). Foco:
 *  - `tutor_conversations`/`tutor_messages`: SOLO el propio alumno dueño lee
 *    (el staff NO tiene rama de lectura — decisión de minimizacion, distinta
 *    de `certificates`/`scorm_cmi`). Aislado por tenant.
 *  - `course_chunks`: cualquier rol del tenant lee; tenant B no ve nada.
 *  - `tutor_course_config`/`tutor_usage_daily`: un alumno no puede escribir
 *    directo (deny-by-default; solo vía servicio/RPC).
 *  - RPC `tutor_add_usage`: rechaza `p_user_id` distinto de `auth.uid()`.
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
const ENROLLMENT_A1 = "e0000000-0000-4000-8000-000000000001"; // aaaaaaaa...005 (student)
const ENROLLMENT_A2 = "e0000000-0000-4000-8000-000000000002"; // aaaaaaaa...008 (student, otro alumno)
const STUDENT_A1 = "aaaaaaaa-0000-4000-8000-000000000005";
const STUDENT_A2 = "aaaaaaaa-0000-4000-8000-000000000008";
const STAFF_A = "aaaaaaaa-0000-4000-8000-000000000001";

const LESSON_ID = randomUUID();
const CHUNK_ID = randomUUID();
const CONVERSATION_ID = randomUUID();
const MESSAGE_ID = randomUUID();

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

  const lesson = await svc.from("lessons").insert({
    id: LESSON_ID,
    tenant_id: TENANT_A,
    course_id: COURSE_A,
    title: "Lección Tutor IA (RLS fixture)",
    kind: "text",
    content: "Contenido de prueba para el Tutor IA.",
    position: 98,
    status: "published",
  });
  if (lesson.error) throw new Error(`seed lessons: ${lesson.error.message}`);

  const chunk = await svc.from("course_chunks").insert({
    id: CHUNK_ID,
    tenant_id: TENANT_A,
    course_id: COURSE_A,
    lesson_id: LESSON_ID,
    chunk_index: 0,
    lesson_title: "Lección Tutor IA (RLS fixture)",
    content: "Contenido de prueba para el Tutor IA.",
  });
  if (chunk.error) throw new Error(`seed course_chunks: ${chunk.error.message}`);

  const conversation = await svc.from("tutor_conversations").insert({
    id: CONVERSATION_ID,
    tenant_id: TENANT_A,
    enrollment_id: ENROLLMENT_A1,
    course_id: COURSE_A,
    user_id: STUDENT_A1,
  });
  if (conversation.error) throw new Error(`seed tutor_conversations: ${conversation.error.message}`);

  const message = await svc.from("tutor_messages").insert({
    id: MESSAGE_ID,
    tenant_id: TENANT_A,
    conversation_id: CONVERSATION_ID,
    user_id: STUDENT_A1,
    role: "user",
    content: "¿qué es un riesgo laboral?",
  });
  if (message.error) throw new Error(`seed tutor_messages: ${message.error.message}`);

  const config = await svc
    .from("tutor_course_config")
    .upsert({ tenant_id: TENANT_A, course_id: COURSE_A, enabled: true }, { onConflict: "tenant_id,course_id" });
  if (config.error) throw new Error(`seed tutor_course_config: ${config.error.message}`);

  const budget = await svc
    .from("tutor_tenant_budget")
    .upsert({ tenant_id: TENANT_A, monthly_token_budget: 1_000_000 }, { onConflict: "tenant_id" });
  if (budget.error) throw new Error(`seed tutor_tenant_budget: ${budget.error.message}`);

  // Seed vía service_role: usa `tutor_add_usage_system` (la puerta explícita
  // para escrituras SIN sesión de usuario) — `tutor_add_usage` ahora rechaza
  // incondicionalmente cualquier llamada sin `auth.uid()` (hallazgo MED).
  const usage = await svc.rpc("tutor_add_usage_system", {
    p_tenant_id: TENANT_A,
    p_user_id: STUDENT_A1,
    p_day: new Date().toISOString().slice(0, 10),
    p_messages: 1,
    p_input_tokens: 10,
    p_output_tokens: 20,
  });
  if (usage.error) throw new Error(`seed tutor_usage_daily via RPC: ${usage.error.message}`);
});

afterAll(async () => {
  const svc = serviceClient();
  // Orden respeta las FK restrict: hijos primero.
  await svc.from("tutor_messages").delete().eq("id", MESSAGE_ID);
  await svc.from("tutor_conversations").delete().eq("id", CONVERSATION_ID);
  await svc.from("course_chunks").delete().eq("id", CHUNK_ID);
  await svc.from("lessons").delete().eq("id", LESSON_ID);
  // tutor_usage_daily NO tiene grant de DELETE para nadie (ni siquiera
  // service_role) -- es un ledger agregado, mismo espíritu que `scorm_cmi`/
  // `audit_log`. Este intento es best-effort y se espera que sea un no-op;
  // `supabase db reset` es lo que realmente limpia entre corridas de la suite.
  await svc.from("tutor_usage_daily").delete().eq("tenant_id", TENANT_A).eq("user_id", STUDENT_A1);
  // tutor_course_config/tutor_tenant_budget del curso demo: no se borran (otras
  // suites podrían depender de que existan); son upserts idempotentes.
});

describe("course_chunks — cualquier rol del tenant lee; tenant B aislado", () => {
  it("otec_admin/coordinator/instructor/student del tenant A lo leen", async () => {
    for (const role of ["otec_admin", "coordinator", "instructor", "student"]) {
      const c = client(await jwt({ sub: STAFF_A, tenant_id: TENANT_A, roles: [role] }));
      const { data, error } = await c.from("course_chunks").select("id").eq("id", CHUNK_ID);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(1);
    }
  });

  it("el tenant B no lo ve", async () => {
    const c = client(await jwt({ sub: "bbbbbbbb-0000-4000-8000-000000000001", tenant_id: TENANT_B, roles: ["otec_admin"] }));
    expect((await c.from("course_chunks").select("id").eq("id", CHUNK_ID)).data ?? []).toHaveLength(0);
  });

  it("authenticated no puede insertar directo (deny-by-default; solo service_role)", async () => {
    const c = client(await jwt({ sub: STAFF_A, tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const { error } = await c.from("course_chunks").insert({
      tenant_id: TENANT_A,
      course_id: COURSE_A,
      lesson_id: LESSON_ID,
      chunk_index: 99,
      lesson_title: "x",
      content: "x",
    });
    expect(error).not.toBeNull();
  });
});

describe("tutor_conversations/tutor_messages — HU-11.3: SOLO el propio alumno, staff SIN rama de lectura", () => {
  it("el alumno dueño lee su propia conversación y sus mensajes", async () => {
    const owner = client(await jwt({ sub: STUDENT_A1, tenant_id: TENANT_A, roles: ["student"] }));
    expect((await owner.from("tutor_conversations").select("id").eq("id", CONVERSATION_ID)).data ?? []).toHaveLength(1);
    expect((await owner.from("tutor_messages").select("id").eq("id", MESSAGE_ID)).data ?? []).toHaveLength(1);
  });

  it("OTRO alumno del MISMO tenant NO ve la conversación ni los mensajes (adversarial)", async () => {
    const other = client(await jwt({ sub: STUDENT_A2, tenant_id: TENANT_A, roles: ["student"] }));
    expect((await other.from("tutor_conversations").select("id").eq("id", CONVERSATION_ID)).data ?? []).toHaveLength(0);
    expect((await other.from("tutor_messages").select("id").eq("id", MESSAGE_ID)).data ?? []).toHaveLength(0);
  });

  it("el tenant B no ve nada (aislamiento)", async () => {
    const c = client(await jwt({ sub: "bbbbbbbb-0000-4000-8000-000000000001", tenant_id: TENANT_B, roles: ["otec_admin"] }));
    expect((await c.from("tutor_conversations").select("id").eq("id", CONVERSATION_ID)).data ?? []).toHaveLength(0);
    expect((await c.from("tutor_messages").select("id").eq("id", MESSAGE_ID)).data ?? []).toHaveLength(0);
  });

  it("staff académico (otec_admin/coordinator/instructor/tutor) del MISMO tenant NO lee — 0 filas, no error (decisión de minimización)", async () => {
    for (const role of ["otec_admin", "coordinator", "instructor", "tutor"]) {
      const c = client(await jwt({ sub: STAFF_A, tenant_id: TENANT_A, roles: [role] }));
      const conv = await c.from("tutor_conversations").select("id").eq("id", CONVERSATION_ID);
      expect(conv.error).toBeNull();
      expect(conv.data ?? []).toHaveLength(0);
      const msg = await c.from("tutor_messages").select("id").eq("id", MESSAGE_ID);
      expect(msg.error).toBeNull();
      expect(msg.data ?? []).toHaveLength(0);
    }
  });

  it("superadmin SÍ ve (soporte de plataforma)", async () => {
    const c = client(await jwt({ sub: "00000000-0000-4000-8000-00000000000a", roles: ["superadmin"] }));
    expect((await c.from("tutor_conversations").select("id").eq("id", CONVERSATION_ID)).data ?? []).toHaveLength(1);
  });

  it("un alumno no puede insertar directo (solo vía servicio con service_role)", async () => {
    const c = client(await jwt({ sub: STUDENT_A1, tenant_id: TENANT_A, roles: ["student"] }));
    const { error } = await c.from("tutor_conversations").insert({
      tenant_id: TENANT_A,
      enrollment_id: ENROLLMENT_A2,
      course_id: COURSE_A,
      user_id: STUDENT_A1,
    });
    expect(error).not.toBeNull();
  });
});

describe("tutor_course_config — todo el tenant lee; escritura solo vía servicio", () => {
  it("student/staff del tenant A lo leen", async () => {
    for (const role of ["student", "otec_admin"]) {
      const c = client(await jwt({ sub: STUDENT_A1, tenant_id: TENANT_A, roles: [role] }));
      const { data, error } = await c.from("tutor_course_config").select("enabled").eq("course_id", COURSE_A);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(1);
    }
  });

  it("el tenant B no lo ve", async () => {
    const c = client(await jwt({ sub: "bbbbbbbb-0000-4000-8000-000000000001", tenant_id: TENANT_B, roles: ["otec_admin"] }));
    expect((await c.from("tutor_course_config").select("course_id").eq("course_id", COURSE_A)).data ?? []).toHaveLength(0);
  });

  it("un alumno NO puede escribir tutor_course_config (deny-by-default)", async () => {
    const c = client(await jwt({ sub: STUDENT_A1, tenant_id: TENANT_A, roles: ["student"] }));
    const insert = await c.from("tutor_course_config").insert({ tenant_id: TENANT_A, course_id: randomUUID(), enabled: true });
    expect(insert.error).not.toBeNull();
    const update = await c.from("tutor_course_config").update({ enabled: false }).eq("course_id", COURSE_A).select("course_id");
    expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);
  });

  it("un otec_admin TAMPOCO puede escribir directo (solo vía servicio con service_role; RLS no distingue rol en el GRANT de tabla)", async () => {
    const c = client(await jwt({ sub: STAFF_A, tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const insert = await c.from("tutor_course_config").insert({ tenant_id: TENANT_A, course_id: randomUUID(), enabled: true });
    expect(insert.error).not.toBeNull();
  });
});

describe("tutor_usage_daily — el propio alumno o staff leen; sin insert/update directo para nadie", () => {
  it("el propio alumno lee su fila", async () => {
    const c = client(await jwt({ sub: STUDENT_A1, tenant_id: TENANT_A, roles: ["student"] }));
    const { data, error } = await c.from("tutor_usage_daily").select("messages").eq("user_id", STUDENT_A1);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
    expect(data?.[0]?.messages).toBe(1);
  });

  it("OTRO alumno del mismo tenant no ve la fila ajena", async () => {
    const c = client(await jwt({ sub: STUDENT_A2, tenant_id: TENANT_A, roles: ["student"] }));
    expect((await c.from("tutor_usage_daily").select("user_id").eq("user_id", STUDENT_A1)).data ?? []).toHaveLength(0);
  });

  it("staff del tenant SÍ ve la fila del alumno (panel de uso)", async () => {
    const c = client(await jwt({ sub: STAFF_A, tenant_id: TENANT_A, roles: ["otec_admin"] }));
    expect((await c.from("tutor_usage_daily").select("user_id").eq("user_id", STUDENT_A1)).data ?? []).toHaveLength(1);
  });

  it("un alumno no puede insertar/actualizar directo (sin RPC)", async () => {
    const c = client(await jwt({ sub: STUDENT_A1, tenant_id: TENANT_A, roles: ["student"] }));
    const insert = await c.from("tutor_usage_daily").insert({
      tenant_id: TENANT_A,
      user_id: STUDENT_A1,
      day: "2020-01-01",
      messages: 1,
    });
    expect(insert.error).not.toBeNull();
    const update = await c
      .from("tutor_usage_daily")
      .update({ messages: 999 })
      .eq("user_id", STUDENT_A1)
      .select("user_id");
    expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);
  });
});

describe("RPC tutor_add_usage — valida al propio usuario y acumula", () => {
  it("rechaza SIEMPRE una llamada sin auth.uid() (service_role) — hallazgo MED: antes el chequeo se saltaba entero", async () => {
    const svc = serviceClient();
    const { error } = await svc.rpc("tutor_add_usage", {
      p_tenant_id: TENANT_A,
      p_user_id: STUDENT_A1,
      p_day: new Date().toISOString().slice(0, 10),
      p_messages: 1,
      p_input_tokens: 1,
      p_output_tokens: 1,
    });
    // No hay GRANT de EXECUTE para service_role en esta RPC (deny-by-default
    // explícito) -- Postgres rechaza antes incluso de entrar a la función.
    expect(error).not.toBeNull();
  });

  it("rechaza p_user_id distinto de auth.uid() cuando se llama como usuario autenticado", async () => {
    const c = client(await jwt({ sub: STUDENT_A1, tenant_id: TENANT_A, roles: ["student"] }));
    const { error } = await c.rpc("tutor_add_usage", {
      p_tenant_id: TENANT_A,
      p_user_id: STUDENT_A2, // suplantando a otro alumno
      p_day: new Date().toISOString().slice(0, 10),
      p_messages: 1,
      p_input_tokens: 1,
      p_output_tokens: 1,
    });
    expect(error).not.toBeNull();
  });

  it("acepta y ACUMULA cuando p_user_id coincide con auth.uid()", async () => {
    const c = client(await jwt({ sub: STUDENT_A1, tenant_id: TENANT_A, roles: ["student"] }));
    const day = "2020-06-15"; // fecha fija, ajena a la del seed de beforeAll
    const first = await c.rpc("tutor_add_usage", {
      p_tenant_id: TENANT_A,
      p_user_id: STUDENT_A1,
      p_day: day,
      p_messages: 2,
      p_input_tokens: 5,
      p_output_tokens: 7,
    });
    expect(first.error).toBeNull();
    const second = await c.rpc("tutor_add_usage", {
      p_tenant_id: TENANT_A,
      p_user_id: STUDENT_A1,
      p_day: day,
      p_messages: 3,
      p_input_tokens: 1,
      p_output_tokens: 1,
    });
    expect(second.error).toBeNull();

    const svc = serviceClient();
    const { data } = await svc
      .from("tutor_usage_daily")
      .select("messages, input_tokens, output_tokens")
      .eq("tenant_id", TENANT_A)
      .eq("user_id", STUDENT_A1)
      .eq("day", day)
      .maybeSingle();
    expect(data).toEqual({ messages: 5, input_tokens: 6, output_tokens: 8 });

    // Best-effort (sin grant de DELETE, ver el comentario del afterAll de arriba).
    await svc.from("tutor_usage_daily").delete().eq("tenant_id", TENANT_A).eq("user_id", STUDENT_A1).eq("day", day);
  });
});

describe("RPC tutor_add_usage_system — puerta explícita SOLO service_role, sin chequeo de auth.uid()", () => {
  it("un usuario autenticado NO puede invocarla (sin GRANT de EXECUTE; deny-by-default)", async () => {
    const c = client(await jwt({ sub: STUDENT_A1, tenant_id: TENANT_A, roles: ["student"] }));
    const { error } = await c.rpc("tutor_add_usage_system", {
      p_tenant_id: TENANT_A,
      p_user_id: STUDENT_A1,
      p_day: new Date().toISOString().slice(0, 10),
      p_messages: 1,
      p_input_tokens: 1,
      p_output_tokens: 1,
    });
    expect(error).not.toBeNull();
  });

  it("service_role SÍ puede invocarla y acumula (ruta de sistema: seed/tests, futuro backfill del worker)", async () => {
    const svc = serviceClient();
    const day = "2020-09-09"; // fecha fija, ajena a otros tests
    const first = await svc.rpc("tutor_add_usage_system", {
      p_tenant_id: TENANT_A,
      p_user_id: STUDENT_A2,
      p_day: day,
      p_messages: 4,
      p_input_tokens: 9,
      p_output_tokens: 11,
    });
    expect(first.error).toBeNull();

    const { data } = await svc
      .from("tutor_usage_daily")
      .select("messages, input_tokens, output_tokens")
      .eq("tenant_id", TENANT_A)
      .eq("user_id", STUDENT_A2)
      .eq("day", day)
      .maybeSingle();
    expect(data).toEqual({ messages: 4, input_tokens: 9, output_tokens: 11 });

    // Best-effort (sin grant de DELETE, ver el comentario del afterAll de arriba).
    await svc.from("tutor_usage_daily").delete().eq("tenant_id", TENANT_A).eq("user_id", STUDENT_A2).eq("day", day);
  });
});
