/**
 * RLS de certificados (task 3.2, HU-7.1/7.2): aislamiento por tenant, el alumno
 * ve solo los suyos, la verificación PÚBLICA (RPC anon) nunca expone el RUN
 * completo, e inmutabilidad (revocado no reactiva; un solo vigente por
 * inscripción; sin DELETE). Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const COURSE_A = "c0000000-0000-4000-8000-000000000001";
const ACTION_A = "ac000000-0000-4000-8000-000000000001";
const ENROLLMENT_A = "e0000000-0000-4000-8000-000000000001";
const STUDENT_A = "aaaaaaaa-0000-4000-8000-000000000005";
const OTHER_STUDENT_A = "aaaaaaaa-0000-4000-8000-000000000006";

const CERT_ID = randomUUID();
const TOKEN = randomBytes(16).toString("hex");
const FULL_RUN = "12.345.678-9";

interface LocalEnv { apiUrl: string; anonKey: string; serviceRoleKey: string; jwtSecret: string }

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
    .setProtectedHeader({ alg: "HS256" }).setSubject(claims.sub).setAudience("authenticated").setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.jwtSecret));
}
function client(token?: string): SupabaseClient {
  return createClient(env.apiUrl, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: token ? { headers: { Authorization: `Bearer ${token}` } } : {} });
}
function serviceClient(): SupabaseClient { return createClient(env.apiUrl, env.serviceRoleKey, { auth: { persistSession: false } }); }

beforeAll(async () => {
  env = loadLocalEnv();
  const svc = serviceClient();
  const snapshot = {
    studentName: "Ana Díaz", run: FULL_RUN, runMasked: "12.XXX.XXX-X", courseName: "Curso RLS",
    hours: 40, startsOn: "2026-07-01", endsOn: "2026-07-31", finalGrade: 6.5, codSence: "1234567890",
    actionCode: "ACC-DEMO-0001", attendancePct: 90, otecName: "OTEC Demo Andes SpA", otecRut: "76.111.111-6",
    brandPrimary: "#1e3a8a", brandAccent: "#0ea5e9", logoUrl: null, isSence: true, issuedAtISO: "2026-07-16T12:00:00.000Z",
  };
  const ins = await svc.from("certificates").insert({
    id: CERT_ID, tenant_id: TENANT_A, enrollment_id: ENROLLMENT_A, action_id: ACTION_A, course_id: COURSE_A,
    folio: `CERT-2026-${Math.floor(Math.random() * 900000 + 100000)}`, verification_token: TOKEN,
    is_sence: true, snapshot,
  });
  if (ins.error) throw new Error(`seed cert: ${ins.error.message}`);
});

describe("certificates — lecturas por rol", () => {
  it("el staff del tenant A (otec_admin/coordinator/instructor/supervisor) lo lee", async () => {
    for (const role of ["otec_admin", "coordinator", "instructor", "supervisor"]) {
      const c = client(await jwt({ sub: STUDENT_A, tenant_id: TENANT_A, roles: [role] }));
      const { data, error } = await c.from("certificates").select("id").eq("id", CERT_ID);
      expect(error).toBeNull();
      expect((data ?? []).length).toBe(1);
    }
  });

  it("el alumno dueño lo ve; otro alumno del tenant NO", async () => {
    const owner = client(await jwt({ sub: STUDENT_A, tenant_id: TENANT_A, roles: ["student"] }));
    expect((await owner.from("certificates").select("id").eq("id", CERT_ID)).data ?? []).toHaveLength(1);
    const other = client(await jwt({ sub: OTHER_STUDENT_A, tenant_id: TENANT_A, roles: ["student"] }));
    expect((await other.from("certificates").select("id").eq("id", CERT_ID)).data ?? []).toHaveLength(0);
  });

  it("el otec_admin del tenant B no lo ve (aislamiento)", async () => {
    const c = client(await jwt({ sub: "bbbbbbbb-0000-4000-8000-000000000001", tenant_id: TENANT_B, roles: ["otec_admin"] }));
    expect((await c.from("certificates").select("id").eq("id", CERT_ID)).data ?? []).toHaveLength(0);
  });

  it("certificate_counters no es legible por authenticated", async () => {
    const c = client(await jwt({ sub: STUDENT_A, tenant_id: TENANT_A, roles: ["otec_admin"] }));
    const { data, error } = await c.from("certificate_counters").select("*");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});

describe("verify_certificate — público (anon), sin RUN completo", () => {
  it("anon obtiene datos mínimos + RUN enmascarado; nunca el RUN completo", async () => {
    const anon = client();
    const { data, error } = await anon.rpc("verify_certificate", { p_token: TOKEN });
    expect(error).toBeNull();
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
    expect(row.run_masked).toBe("12.XXX.XXX-X");
    expect(row.student_name).toBe("Ana Díaz");
    // Ninguna columna devuelta contiene el RUN completo.
    expect(JSON.stringify(row)).not.toContain(FULL_RUN);
    expect(JSON.stringify(row)).not.toContain("345.678");
  });

  it("un token inexistente no devuelve filas", async () => {
    const anon = client();
    const { data } = await anon.rpc("verify_certificate", { p_token: "no-existe" });
    expect(data ?? []).toHaveLength(0);
  });
});

describe("certificates — inmutabilidad", () => {
  it("un revocado no se reactiva y no hay dos vigentes por inscripción", async () => {
    const svc = serviceClient();
    // Segundo certificado VIGENTE para la misma inscripción → abortado.
    const dup = await svc.from("certificates").insert({
      id: randomUUID(), tenant_id: TENANT_A, enrollment_id: ENROLLMENT_A, action_id: ACTION_A, course_id: COURSE_A,
      folio: `CERT-2026-${Math.floor(Math.random() * 900000 + 100000)}`, verification_token: randomBytes(16).toString("hex"),
      is_sence: true, snapshot: {},
    });
    expect(dup.error).not.toBeNull();

    // Revocar (permitido) y luego intentar reactivar (abortado por el trigger).
    await svc.from("certificates").update({ status: "revoked", revoked_reason: "prueba", revoked_at: new Date().toISOString() }).eq("id", CERT_ID);
    const reactivate = await svc.from("certificates").update({ status: "issued" }).eq("id", CERT_ID).select("id");
    expect(reactivate.error).not.toBeNull();
  });
});
