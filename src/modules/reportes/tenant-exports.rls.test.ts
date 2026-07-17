/**
 * RLS del export completo del tenant (task 5.13, HU-1.5).
 *
 * Qué fija, a nivel BD (no de servicio):
 *  - SOLO `otec_admin` lee `tenant_exports` — ni `coordinator` ni `student`: el
 *    export trae RUN, notas, certificados y documentos de TODA la OTEC, un
 *    universo más amplio que cualquier policy por tabla le concede hoy al
 *    coordinador;
 *  - otec_admin@A no ve los exports del tenant B (RNF-1);
 *  - `authenticated` no puede escribir por tabla (ni insert ni update): el
 *    único camino de escritura es el servicio (gate + auditoría) y el worker.
 *
 * Las filas se siembran con `status = 'done'` a propósito: el índice único
 * parcial es solo sobre `pending`/`running`, así que una fila `done` no
 * interfiere con el "un export en vuelo por tenant" que ejercita la suite de
 * integración (no hay DELETE ni para el service_role — es historial, como
 * `certificates` — así que el residuo queda pero es inerte).
 *
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const USER_ADMIN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_COORD_A = "aaaaaaaa-0000-4000-8000-000000000002";
const USER_STUDENT_A = "aaaaaaaa-0000-4000-8000-000000000005";
const USER_ADMIN_B = "bbbbbbbb-0000-4000-8000-000000000001";

const EXPORT_A = randomUUID();
const EXPORT_B = randomUUID();

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
  // `status: 'done'` a propósito (ver cabecera): no compite con el índice
  // único parcial de pending/running que usa la suite de integración.
  unwrap("seed export A", (await db.from("tenant_exports").insert({
    id: EXPORT_A, tenant_id: TENANT_A, requested_by: USER_ADMIN_A, status: "done",
    file_path: `${TENANT_A}/${EXPORT_A}.zip`, file_size: 1024,
  })).error);
  unwrap("seed export B", (await db.from("tenant_exports").insert({
    id: EXPORT_B, tenant_id: TENANT_B, requested_by: USER_ADMIN_B, status: "done",
    file_path: `${TENANT_B}/${EXPORT_B}.zip`, file_size: 2048,
  })).error);
});

describe("tenant_exports — dato de otec_admin, por tenant (task 5.13)", () => {
  it("★ el ALUMNO no lee la cola de exports", async () => {
    const db = await clientAs(USER_STUDENT_A, ["student"]);
    const { data, error } = await db.from("tenant_exports").select("id");
    expect(error).toBeNull();
    expect(data ?? [], "el alumno no debe ver ningún export").toEqual([]);
  });

  it("★ el COORDINADOR tampoco lee (el export trae más que lo que ve por tabla)", async () => {
    const db = await clientAs(USER_COORD_A, ["coordinator"]);
    const { data, error } = await db.from("tenant_exports").select("id");
    expect(error).toBeNull();
    expect(data ?? [], "el coordinador no debe ver la cola de exports").toEqual([]);
  });

  it("★ otec_admin@A SÍ lee su export (no es una negación global)", async () => {
    const db = await clientAs(USER_ADMIN_A, ["otec_admin"]);
    const { data, error } = await db.from("tenant_exports").select("id, tenant_id, status").eq("id", EXPORT_A);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([EXPORT_A]);
    expect((data ?? [])[0]!.tenant_id).toBe(TENANT_A);
  });

  it("★ otec_admin@A NO ve el export del tenant B (RNF-1), ni pidiéndolo por id", async () => {
    const db = await clientAs(USER_ADMIN_A, ["otec_admin"]);
    const all = await db.from("tenant_exports").select("id");
    expect((all.data ?? []).some((r) => r.id === EXPORT_B), "fuga: ve el export del tenant B").toBe(false);

    const direct = await db.from("tenant_exports").select("id").eq("id", EXPORT_B);
    expect(direct.error).toBeNull();
    expect(direct.data ?? []).toEqual([]);
  });

  it("★ authenticated NO puede INSERTAR en la cola por tabla (sin policy de escritura)", async () => {
    for (const roles of [["otec_admin"], ["coordinator"], ["student"]]) {
      const db = await clientAs(USER_ADMIN_A, roles);
      const { error } = await db.from("tenant_exports").insert({ tenant_id: TENANT_A, requested_by: USER_ADMIN_A });
      expect(error, `${roles[0]} no debería poder insertar un export por tabla`).not.toBeNull();
    }
  });

  it("★ authenticated NO puede ACTUALIZAR una fila por tabla (ni el dueño de la solicitud)", async () => {
    const db = await clientAs(USER_ADMIN_A, ["otec_admin"]);
    const upd = await db.from("tenant_exports").update({ status: "failed" }).eq("id", EXPORT_A).select("id");
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);

    const { data } = await svc().from("tenant_exports").select("status").eq("id", EXPORT_A).single();
    expect(data!.status, "el estado se modificó por un camino que no debería existir").toBe("done");
  });

  it("el índice único parcial impide DOS exports pending/running a la vez por tenant", async () => {
    const db = svc();
    const idPending = randomUUID();
    unwrap("insert pending", (await db.from("tenant_exports").insert({
      id: idPending, tenant_id: TENANT_A, requested_by: USER_ADMIN_A, status: "pending",
    })).error);
    const second = await db.from("tenant_exports").insert({ tenant_id: TENANT_A, requested_by: USER_ADMIN_A, status: "pending" });
    expect(second.error?.code, "un segundo pending/running del mismo tenant debe chocar con el índice único").toBe("23505");

    // Libera el slot para el resto de la suite (UPDATE está permitido; no hay DELETE).
    await db.from("tenant_exports").update({ status: "done" }).eq("id", idPending);
  });
});
