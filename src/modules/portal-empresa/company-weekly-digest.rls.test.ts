/**
 * RLS del ledger del digest semanal de empresa (task 5.9, HU-8.2).
 *
 * Qué fija, a nivel BD (no de servicio):
 *  - es dato del STAFF (transparencia operativa: "¿ya se envió el digest de
 *    esta semana?"); ni el alumno ni la empresa (rol `company`) lo leen;
 *  - el staff del tenant A no ve el ledger del tenant B (RNF-1);
 *  - es INSERT-only y `authenticated` NO puede escribirlo: solo el
 *    `service_role` (el worker) inserta, y nadie —ni él— puede reescribir una
 *    fila ya enviada (mismo criterio que `certificate_expiry_alerts`).
 *
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const USER_STUDENT_A = "aaaaaaaa-0000-4000-8000-000000000005";
const USER_ADMIN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_COMPANY_A = "aaaaaaaa-0000-4000-8000-000000000006";

const COMPANY_A = randomUUID();
const COMPANY_B = randomUUID();
const WEEK = "2026-07-13";

interface LocalEnv { apiUrl: string; anonKey: string; serviceRoleKey: string; jwtSecret: string }
let env: LocalEnv;

function loadLocalEnv(): LocalEnv {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (key: string): string => {
    const match = out.match(new RegExp(`^${key}="?([^"\\r\\n]+)"?$`, "m"));
    if (!match?.[1]) throw new Error(`supabase status no expone ${key}; ¿corriste supabase start?`);
    return match[1];
  };
  return { apiUrl: get("API_URL"), anonKey: get("ANON_KEY"), serviceRoleKey: get("SERVICE_ROLE_KEY"), jwtSecret: get("JWT_SECRET") };
}

async function jwt(sub: string, roles: string[], tenant: string): Promise<string> {
  return new SignJWT({ role: "authenticated", tenant_id: tenant, roles })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.jwtSecret));
}
function client(token: string): SupabaseClient {
  return createClient(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
function svc(): SupabaseClient {
  return createClient(env.apiUrl, env.serviceRoleKey, { auth: { persistSession: false } });
}
async function clientAs(sub: string, roles: string[], tenant = TENANT_A): Promise<SupabaseClient> {
  return client(await jwt(sub, roles, tenant));
}
function unwrap(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`${label}: ${error.message}`);
}

beforeAll(async () => {
  env = loadLocalEnv();
  const db = svc();

  unwrap("seed empresa A", (await db.from("companies").insert({
    id: COMPANY_A, tenant_id: TENANT_A, rut: `70${Math.floor(Math.random() * 900000 + 100000)}-0`,
    razon_social: "Empresa Digest RLS A",
  })).error);
  unwrap("seed empresa B", (await db.from("companies").insert({
    id: COMPANY_B, tenant_id: TENANT_B, rut: `71${Math.floor(Math.random() * 900000 + 100000)}-0`,
    razon_social: "Empresa Digest RLS B",
  })).error);
  unwrap("seed ledger A", (await db.from("company_weekly_digest_log").insert({
    tenant_id: TENANT_A, company_id: COMPANY_A, week_start: WEEK,
  })).error);
  unwrap("seed ledger B", (await db.from("company_weekly_digest_log").insert({
    tenant_id: TENANT_B, company_id: COMPANY_B, week_start: WEEK,
  })).error);
});

afterAll(async () => {
  // `company_weekly_digest_log` NO tiene DELETE ni para el service_role (INSERT-only
  // a propósito, P8). `companies` tampoco tiene DELETE (D-030-like: precedente de
  // `company.rls.test.ts`). El residuo es INERTE: ids aleatorios por corrida.
});

describe("company_weekly_digest_log — ledger de staff, INSERT-only (task 5.9)", () => {
  it("★ el ALUMNO no lee el ledger del digest", async () => {
    const db = await clientAs(USER_STUDENT_A, ["student"]);
    const { data, error } = await db.from("company_weekly_digest_log").select("id, company_id");
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("la EMPRESA (rol company) tampoco lee el ledger (es dato operativo del OTEC, no del cliente)", async () => {
    const db = await clientAs(USER_COMPANY_A, ["company"]);
    const { data, error } = await db.from("company_weekly_digest_log").select("id");
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("★ otec_admin@A ve SU ledger y NINGUNO del tenant B", async () => {
    const db = await clientAs(USER_ADMIN_A, ["otec_admin"]);
    const { data, error } = await db.from("company_weekly_digest_log").select("company_id, tenant_id");
    expect(error).toBeNull();
    const companyIds = (data ?? []).map((r) => r.company_id);
    expect(companyIds, "el admin debe ver el ledger de su tenant").toContain(COMPANY_A);
    expect(companyIds, "fuga: ve el ledger del tenant B").not.toContain(COMPANY_B);
    expect((data ?? []).every((r) => r.tenant_id === TENANT_A)).toBe(true);
  });

  it("coordinator e instructor también leen el ledger de su tenant (no es solo otec_admin)", async () => {
    for (const role of ["coordinator", "instructor"]) {
      const db = await clientAs(USER_ADMIN_A, [role]);
      const { data, error } = await db.from("company_weekly_digest_log").select("company_id").eq("company_id", COMPANY_A);
      expect(error, `${role} no debería recibir error`).toBeNull();
      expect((data ?? []).map((r) => r.company_id), `${role} debe ver el ledger de su tenant`).toContain(COMPANY_A);
    }
  });

  it("★ authenticated NO puede INSERTAR en el ledger (solo el worker/service_role)", async () => {
    for (const roles of [["otec_admin"], ["coordinator"], ["student"]]) {
      const db = await clientAs(USER_ADMIN_A, roles);
      const { error } = await db.from("company_weekly_digest_log").insert({
        tenant_id: TENANT_A, company_id: COMPANY_A, week_start: "2026-07-20",
      });
      expect(error, `${roles[0]} no debería poder insertar en el ledger`).not.toBeNull();
    }
  });

  it("★ authenticated NO puede BORRAR ni ACTUALIZAR el ledger", async () => {
    const db = await clientAs(USER_ADMIN_A, ["otec_admin"]);
    const del = await db.from("company_weekly_digest_log").delete().eq("company_id", COMPANY_A).select("id");
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);
    const upd = await db.from("company_weekly_digest_log").update({ week_start: "2026-08-01" }).eq("company_id", COMPANY_A).select("id");
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);

    const { data } = await svc().from("company_weekly_digest_log").select("week_start").eq("company_id", COMPANY_A).single();
    expect(data!.week_start).toBe(WEEK);
  });

  it("★ el ledger es INSERT-only incluso para el service_role (P8: no se reescribe)", async () => {
    const db = svc();
    const del = await db.from("company_weekly_digest_log").delete().eq("company_id", COMPANY_A).select("id");
    expect(del.error !== null || (del.data ?? []).length === 0, "el service_role NO debe poder borrar el ledger").toBe(true);
    const upd = await db.from("company_weekly_digest_log").update({ week_start: "2026-08-01" }).eq("company_id", COMPANY_A).select("id");
    expect(upd.error !== null || (upd.data ?? []).length === 0, "el service_role NO debe poder actualizar el ledger").toBe(true);
  });

  it("el unique (tenant_id, company_id, week_start) es lo que da la idempotencia del job", async () => {
    const { error } = await svc().from("company_weekly_digest_log").insert({
      tenant_id: TENANT_A, company_id: COMPANY_A, week_start: WEEK,
    });
    expect(error?.code, "un digest repetido de la misma semana debe chocar con el unique (23505)").toBe("23505");
  });
});
