/**
 * RLS de la ingesta SCORM (task 5.1a, HU-4.2, ADR-006): `scorm_packages` es
 * staff-only (el alumno pasa por el proxy autenticado de la 5.1b, no lee la
 * tabla directo); `scorm_cmi` la lee el propio alumno dueño de la inscripción
 * o el staff de gestión. Aislamiento por tenant en ambas. Requiere
 * `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const COURSE_A = "c0000000-0000-4000-8000-000000000001";
const ENROLLMENT_A = "e0000000-0000-4000-8000-000000000001";
const STUDENT_A = "aaaaaaaa-0000-4000-8000-000000000005";
const OTHER_STUDENT_A = "aaaaaaaa-0000-4000-8000-000000000006";

const PACKAGE_ID = randomUUID();
const LESSON_ID = randomUUID();
const CMI_ID = randomUUID();

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

  const pkg = await svc.from("scorm_packages").insert({
    id: PACKAGE_ID,
    tenant_id: TENANT_A,
    course_id: COURSE_A,
    title: "Paquete SCORM de prueba (RLS)",
    status: "ready",
    scorm_version: "1.2",
    zip_path: `${TENANT_A}/${PACKAGE_ID}/package.zip`,
    entry_href: "index.html",
    file_size: 1024,
    uploaded_by: "aaaaaaaa-0000-4000-8000-000000000001",
  });
  if (pkg.error) throw new Error(`seed scorm_packages: ${pkg.error.message}`);

  const lesson = await svc.from("lessons").insert({
    id: LESSON_ID,
    tenant_id: TENANT_A,
    course_id: COURSE_A,
    title: "Lección SCORM de prueba (RLS)",
    kind: "scorm",
    content: PACKAGE_ID,
    position: 99,
    status: "draft",
  });
  if (lesson.error) throw new Error(`seed lessons: ${lesson.error.message}`);

  const cmi = await svc.from("scorm_cmi").insert({
    id: CMI_ID,
    tenant_id: TENANT_A,
    enrollment_id: ENROLLMENT_A,
    package_id: PACKAGE_ID,
    lesson_id: LESSON_ID,
    lesson_status: "incomplete",
  });
  if (cmi.error) throw new Error(`seed scorm_cmi: ${cmi.error.message}`);
});

/**
 * `scorm_cmi` NO tiene grant de DELETE ni para `service_role` (por diseño: es
 * un historial de intento, mismo espíritu que `audit_log`/`certificates`) y
 * `lessons`/`scorm_packages` tienen FK `on delete restrict` DESDE `scorm_cmi`
 * — así que, una vez sembrada, la fila de `scorm_cmi` deja sus 3 filas
 * relacionadas permanentemente sin poder borrarse (mismo caso documentado en
 * `tenant-service.integration.test.ts`: "el tenant creado NO se puede
 * borrar"). Los intentos de borrado de abajo son best-effort y se espera que
 * NO borren nada; `db reset` es lo que realmente limpia entre corridas.
 */
afterAll(async () => {
  const svc = serviceClient();
  await svc.from("scorm_cmi").delete().eq("id", CMI_ID);
  await svc.from("lessons").delete().eq("id", LESSON_ID);
  await svc.from("scorm_packages").delete().eq("id", PACKAGE_ID);
});

describe("scorm_packages — staff-only, aislado por tenant", () => {
  it("otec_admin/coordinator/instructor lo leen; el alumno NO", async () => {
    for (const role of ["otec_admin", "coordinator", "instructor"]) {
      const c = client(await jwt({ sub: STUDENT_A, tenant_id: TENANT_A, roles: [role] }));
      const { data, error } = await c.from("scorm_packages").select("id").eq("id", PACKAGE_ID);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(1);
    }
    const student = client(await jwt({ sub: STUDENT_A, tenant_id: TENANT_A, roles: ["student"] }));
    expect((await student.from("scorm_packages").select("id").eq("id", PACKAGE_ID)).data ?? []).toHaveLength(0);
  });

  it("el tenant B no lo ve (aislamiento)", async () => {
    const c = client(await jwt({ sub: "bbbbbbbb-0000-4000-8000-000000000001", tenant_id: TENANT_B, roles: ["otec_admin"] }));
    expect((await c.from("scorm_packages").select("id").eq("id", PACKAGE_ID)).data ?? []).toHaveLength(0);
  });

  it("authenticated no puede insertar directo (deny-by-default; solo service_role escribe)", async () => {
    const c = client(await jwt({ sub: "aaaaaaaa-0000-4000-8000-000000000001", tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const { error } = await c.from("scorm_packages").insert({
      tenant_id: TENANT_A,
      course_id: COURSE_A,
      title: "Intento directo",
      zip_path: "x",
      uploaded_by: "aaaaaaaa-0000-4000-8000-000000000001",
    });
    expect(error).not.toBeNull();
  });
});

describe("scorm_cmi — el alumno dueño y el staff; aislado por tenant", () => {
  it("el alumno dueño de la inscripción lo lee; otro alumno del tenant NO", async () => {
    const owner = client(await jwt({ sub: STUDENT_A, tenant_id: TENANT_A, roles: ["student"] }));
    expect((await owner.from("scorm_cmi").select("id").eq("id", CMI_ID)).data ?? []).toHaveLength(1);

    const other = client(await jwt({ sub: OTHER_STUDENT_A, tenant_id: TENANT_A, roles: ["student"] }));
    expect((await other.from("scorm_cmi").select("id").eq("id", CMI_ID)).data ?? []).toHaveLength(0);
  });

  it("staff de gestión (otec_admin/coordinator/instructor/tutor) lo lee", async () => {
    for (const role of ["otec_admin", "coordinator", "instructor", "tutor"]) {
      const c = client(await jwt({ sub: "aaaaaaaa-0000-4000-8000-000000000001", tenant_id: TENANT_A, roles: [role] }));
      const { data, error } = await c.from("scorm_cmi").select("id").eq("id", CMI_ID);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(1);
    }
  });

  it("el tenant B no lo ve (aislamiento)", async () => {
    const c = client(await jwt({ sub: "bbbbbbbb-0000-4000-8000-000000000001", tenant_id: TENANT_B, roles: ["otec_admin"] }));
    expect((await c.from("scorm_cmi").select("id").eq("id", CMI_ID)).data ?? []).toHaveLength(0);
  });

  it("ni siquiera service_role puede DELETE (grant no otorgado — historial no se borra por RLS/grant)", async () => {
    const svc = serviceClient();
    const { error } = await svc.from("scorm_cmi").delete().eq("id", CMI_ID).select("id");
    expect(error).not.toBeNull();
  });
});
