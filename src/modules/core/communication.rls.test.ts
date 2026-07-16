/**
 * RLS de comunicación (task 3.4, M9): el alumno inscrito lee anuncios publicados,
 * foro y SUS mensajes; nadie ajeno los ve; el supervisor NO accede a la
 * mensajería (privacidad); el cliente no escribe (solo el servidor).
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
const STUDENT_A = "aaaaaaaa-0000-4000-8000-000000000005";
const NON_ENROLLED_A = "aaaaaaaa-0000-4000-8000-000000000006"; // no inscrito en COURSE_A

const ANN_ID = randomUUID();
const THREAD_ID = randomUUID();
const MSG_THREAD_ID = randomUUID();

interface LocalEnv { apiUrl: string; anonKey: string; serviceRoleKey: string; jwtSecret: string }
function loadLocalEnv(): LocalEnv {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => { const m = out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m")); if (!m?.[1]) throw new Error(`no ${k}`); return m[1]; };
  return { apiUrl: get("API_URL"), anonKey: get("ANON_KEY"), serviceRoleKey: get("SERVICE_ROLE_KEY"), jwtSecret: get("JWT_SECRET") };
}
let env: LocalEnv;
async function jwt(c: { sub: string; tenant_id?: string; roles: string[] }): Promise<string> {
  return new SignJWT({ role: "authenticated", ...(c.tenant_id ? { tenant_id: c.tenant_id } : {}), roles: c.roles })
    .setProtectedHeader({ alg: "HS256" }).setSubject(c.sub).setAudience("authenticated").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.jwtSecret));
}
function client(token?: string): SupabaseClient { return createClient(env.apiUrl, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: token ? { headers: { Authorization: `Bearer ${token}` } } : {} }); }
function svcClient(): SupabaseClient { return createClient(env.apiUrl, env.serviceRoleKey, { auth: { persistSession: false } }); }

beforeAll(async () => {
  env = loadLocalEnv();
  const svc = svcClient();
  const a = await svc.from("announcements").insert({ id: ANN_ID, tenant_id: TENANT_A, course_id: COURSE_A, author_user_id: STUDENT_A, title: "Aviso", body: "Cuerpo", status: "published", published_at: new Date().toISOString() });
  if (a.error) throw new Error(`seed ann: ${a.error.message}`);
  const th = await svc.from("forum_threads").insert({ id: THREAD_ID, tenant_id: TENANT_A, course_id: COURSE_A, author_user_id: STUDENT_A, title: "Consulta" });
  if (th.error) throw new Error(`seed thread: ${th.error.message}`);
  await svc.from("forum_posts").insert({ tenant_id: TENANT_A, thread_id: THREAD_ID, author_user_id: STUDENT_A, from_staff: false, body: "Hola" });
  const mt = await svc.from("message_threads").insert({ id: MSG_THREAD_ID, tenant_id: TENANT_A, course_id: COURSE_A, student_user_id: STUDENT_A, subject: "Duda" });
  if (mt.error) throw new Error(`seed mthread: ${mt.error.message}`);
  await svc.from("messages").insert({ tenant_id: TENANT_A, thread_id: MSG_THREAD_ID, sender_user_id: STUDENT_A, sender_is_staff: false, body: "Consulta privada" });
});

describe("comunicación — lecturas por rol", () => {
  it("el alumno inscrito lee anuncio publicado, foro y SU mensaje", async () => {
    const c = client(await jwt({ sub: STUDENT_A, tenant_id: TENANT_A, roles: ["student"] }));
    expect((await c.from("announcements").select("id").eq("id", ANN_ID)).data ?? []).toHaveLength(1);
    expect((await c.from("forum_threads").select("id").eq("id", THREAD_ID)).data ?? []).toHaveLength(1);
    expect((await c.from("forum_posts").select("id").eq("thread_id", THREAD_ID)).data ?? []).not.toHaveLength(0);
    expect((await c.from("message_threads").select("id").eq("id", MSG_THREAD_ID)).data ?? []).toHaveLength(1);
    expect((await c.from("messages").select("id").eq("thread_id", MSG_THREAD_ID)).data ?? []).not.toHaveLength(0);
  });

  it("un alumno NO inscrito no ve el foro ni el mensaje ajeno", async () => {
    const c = client(await jwt({ sub: NON_ENROLLED_A, tenant_id: TENANT_A, roles: ["student"] }));
    expect((await c.from("forum_threads").select("id").eq("id", THREAD_ID)).data ?? []).toHaveLength(0);
    expect((await c.from("message_threads").select("id").eq("id", MSG_THREAD_ID)).data ?? []).toHaveLength(0);
    expect((await c.from("messages").select("id").eq("thread_id", MSG_THREAD_ID)).data ?? []).toHaveLength(0);
  });

  it("el supervisor NO accede a la mensajería (privacidad del alumno)", async () => {
    const c = client(await jwt({ sub: "aaaaaaaa-0000-4000-8000-000000000007", tenant_id: TENANT_A, roles: ["supervisor"] }));
    expect((await c.from("message_threads").select("id").eq("id", MSG_THREAD_ID)).data ?? []).toHaveLength(0);
    expect((await c.from("messages").select("id").eq("thread_id", MSG_THREAD_ID)).data ?? []).toHaveLength(0);
    expect((await c.from("announcements").select("id").eq("id", ANN_ID)).data ?? []).toHaveLength(0);
  });

  it("el staff del tenant B no ve la comunicación del tenant A (aislamiento)", async () => {
    const c = client(await jwt({ sub: "bbbbbbbb-0000-4000-8000-000000000001", tenant_id: TENANT_B, roles: ["otec_admin"] }));
    expect((await c.from("announcements").select("id").eq("id", ANN_ID)).data ?? []).toHaveLength(0);
    expect((await c.from("forum_threads").select("id").eq("id", THREAD_ID)).data ?? []).toHaveLength(0);
  });
});

describe("comunicación — el cliente no escribe", () => {
  it("un alumno no inserta anuncios ni marca resuelto el hilo", async () => {
    const c = client(await jwt({ sub: STUDENT_A, tenant_id: TENANT_A, roles: ["student"] }));
    const ins = await c.from("announcements").insert({ tenant_id: TENANT_A, course_id: COURSE_A, author_user_id: STUDENT_A, title: "hack", body: "x" });
    expect(ins.error).not.toBeNull();
    const upd = await c.from("forum_threads").update({ resolved: true }).eq("id", THREAD_ID).select("id");
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
  });
});
