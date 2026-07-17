/**
 * RLS del asistente de creación de cursos (task 5.10, HU-3.5/4.5):
 * `course_drafts` la leen SOLO otec_admin/coordinator del tenant (matriz §3 —
 * el instructor/relator no gestiona altas de curso); nadie escribe directo
 * (solo service_role, vía `wizard-service.ts`). El bucket `course_descriptors`
 * es privado, sin policies para `authenticated`. Requiere `supabase start` +
 * `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const COORDINATOR_A = "aaaaaaaa-0000-4000-8000-000000000002";

const DRAFT_ID = randomUUID();

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
  return { apiUrl: get("API_URL"), anonKey: get("ANON_KEY"), serviceRoleKey: get("SERVICE_ROLE_KEY"), jwtSecret: get("JWT_SECRET") };
}

let env: LocalEnv;

async function jwt(claims: { sub: string; tenant_id?: string; roles: string[] }): Promise<string> {
  return new SignJWT({ role: "authenticated", ...(claims.tenant_id ? { tenant_id: claims.tenant_id } : {}), roles: claims.roles })
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
  const { error } = await svc.from("course_drafts").insert({
    id: DRAFT_ID,
    tenant_id: TENANT_A,
    created_by: COORDINATOR_A,
    source: "scratch",
    state: {},
  });
  if (error) throw new Error(`seed course_drafts: ${error.message}`);
});

afterAll(async () => {
  const svc = serviceClient();
  await svc.from("course_drafts").delete().eq("id", DRAFT_ID);
});

describe("course_drafts — solo otec_admin/coordinator del tenant lo leen", () => {
  it("coordinator@A lee sus drafts", async () => {
    const c = client(await jwt({ sub: COORDINATOR_A, tenant_id: TENANT_A, roles: ["coordinator"] }));
    const { data, error } = await c.from("course_drafts").select("id").eq("id", DRAFT_ID);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  });

  it("otec_admin@A también lee (matriz §3)", async () => {
    const c = client(await jwt({ sub: COORDINATOR_A, tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const { data, error } = await c.from("course_drafts").select("id").eq("id", DRAFT_ID);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  });

  it("instructor@A NO lee (rol sin permiso de gestión — caso adversarial)", async () => {
    const c = client(await jwt({ sub: COORDINATOR_A, tenant_id: TENANT_A, roles: ["instructor"] }));
    const { data, error } = await c.from("course_drafts").select("id").eq("id", DRAFT_ID);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("el alumno NO lee", async () => {
    const c = client(await jwt({ sub: COORDINATOR_A, tenant_id: TENANT_A, roles: ["student"] }));
    const { data, error } = await c.from("course_drafts").select("id").eq("id", DRAFT_ID);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("el tenant B no lo ve (aislamiento)", async () => {
    const c = client(await jwt({ sub: "bbbbbbbb-0000-4000-8000-000000000001", tenant_id: TENANT_B, roles: ["otec_admin"] }));
    const { data, error } = await c.from("course_drafts").select("id").eq("id", DRAFT_ID);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("superadmin ve el draft de cualquier tenant", async () => {
    const c = client(await jwt({ sub: "00000000-0000-4000-8000-00000000000a", roles: ["superadmin"] }));
    const { data, error } = await c.from("course_drafts").select("id").eq("id", DRAFT_ID);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  });

  it("authenticated no puede insertar directo (deny-by-default; solo service_role escribe)", async () => {
    const c = client(await jwt({ sub: COORDINATOR_A, tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const { error } = await c.from("course_drafts").insert({
      tenant_id: TENANT_A,
      created_by: COORDINATOR_A,
      source: "scratch",
      state: {},
    });
    expect(error).not.toBeNull();
  });

  it("authenticated no puede actualizar directo (deny-by-default)", async () => {
    const c = client(await jwt({ sub: COORDINATOR_A, tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const { error } = await c.from("course_drafts").update({ current_step: "estructura" }).eq("id", DRAFT_ID);
    expect(error).not.toBeNull();
  });
});

describe("bucket privado course_descriptors — inaccesible directo sin service-role", () => {
  it("authenticated no puede listar el bucket", async () => {
    const c = client(await jwt({ sub: COORDINATOR_A, tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const { data, error } = await c.storage.from("course_descriptors").list(TENANT_A);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("authenticated no puede subir un archivo", async () => {
    const c = client(await jwt({ sub: COORDINATOR_A, tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const { error } = await c.storage
      .from("course_descriptors")
      .upload(`${TENANT_A}/intento-directo.docx`, new Blob(["x"]), {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    expect(error).not.toBeNull();
  });

  it("anon no puede listar el bucket", async () => {
    const c = client();
    const { data, error } = await c.storage.from("course_descriptors").list(TENANT_A);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});
