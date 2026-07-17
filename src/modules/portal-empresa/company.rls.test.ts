/**
 * RLS del portal de la empresa cliente (task 5.2, HU-8.1) + regresión del
 * follow-up de seguridad H4-R-008.
 *
 * Prueba a nivel BD la CA literal de la HU: "jamás ve alumnos de otras empresas".
 * Antes de esta task el rol `company` tenía permiso PLANO en `enrollments_select` y
 * `sence_sessions_select_staff`: leía a TODOS los inscritos del tenant (con RUN) y
 * toda la asistencia SENCE del OTEC. El caso ESTRELLA de aquí es el cruce DENTRO
 * del mismo tenant (Los Aromos vs Vulcano): el aislamiento por tenant ya existía y
 * NO cubría este hueco.
 *
 * Requiere `supabase start` + `supabase db reset`.
 *
 * Nota de fixtures: los casos que dependen de tablas SIN privilegio de DELETE para
 * el service_role (`sence_sessions`, `grades`, `certificates` — inmutables por
 * diseño) se apoyan en el SEED, que ya modela las dos empresas y al particular. Lo
 * que esta suite siembra (empresas/miembros/inscripciones de prueba) se limpia en
 * el `finally` de `afterAll`, salvo lo que la BD prohíbe borrar (documentado allí).
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

// ---- Semilla (ver supabase/seed.sql): el modelo demo de la task 5.2 ----
const CO_LOS_AROMOS = "c1000000-0000-4000-8000-000000000001";
const CO_VULCANO = "c1000000-0000-4000-8000-000000000002";
const USER_COMPANY_A = "aaaaaaaa-0000-4000-8000-000000000006"; // miembro de Los Aromos
const USER_STUDENT_A = "aaaaaaaa-0000-4000-8000-000000000005";
const USER_SUPERVISOR_A = "aaaaaaaa-0000-4000-8000-000000000007"; // grant tenant vigente
const DEMO_ACTION = "ac000000-0000-4000-8000-000000000001";
const ENR_AROMOS = "e0000000-0000-4000-8000-000000000001"; // María José — Los Aromos
const ENR_PARTICULAR = "e0000000-0000-4000-8000-000000000002"; // Rodrigo — sin empresa
const ENR_VULCANO = "e0000000-0000-4000-8000-000000000003"; // Carolina — Vulcano
const SESS_AROMOS = "50000000-0000-4000-8000-000000000001";
const SESS_VULCANO = "50000000-0000-4000-8000-000000000002";

// ---- Fixtures de esta suite (ids frescos por corrida: sin colisión al re-correr) ----
const CO_B1 = randomUUID(); // empresa del tenant B
const COURSE_B = randomUUID();
const ACTION_B = randomUUID();
const ENR_B = randomUUID(); // inscripción del tenant B, de CO_B1
let USER_REVOKED = ""; // ex-miembro de Los Aromos (revocado)
let USER_COMPANY_B = ""; // miembro de CO_B1
let USER_WORKER_B = ""; // titular de ENR_B

interface LocalEnv { apiUrl: string; anonKey: string; serviceRoleKey: string; jwtSecret: string }

function loadLocalEnv(): LocalEnv {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (key: string): string => {
    const match = out.match(new RegExp(`^${key}="?([^"\\r\\n]+)"?$`, "m"));
    if (!match?.[1]) throw new Error(`supabase status no expone ${key}; ¿corriste supabase start?`);
    return match[1];
  };
  return { apiUrl: get("API_URL"), anonKey: get("ANON_KEY"), serviceRoleKey: get("SERVICE_ROLE_KEY"), jwtSecret: get("JWT_SECRET") };
}

let env: LocalEnv;

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

/** Cliente con rol `company` (el rol que este PR escopa). */
async function companyClient(sub: string, tenant = TENANT_A): Promise<SupabaseClient> {
  return client(await jwt(sub, ["company"], tenant));
}

async function freshUser(db: SupabaseClient): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({
    email: `co-${randomUUID().slice(0, 12)}@t.cl`,
    email_confirm: true,
    password: `Co-${randomUUID()}`,
  });
  if (error || !data?.user) throw new Error(`createUser: ${error?.message ?? "sin id"}`);
  return data.user.id;
}

function unwrap(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`${label}: ${error.message}`);
}

beforeAll(async () => {
  env = loadLocalEnv();
  const db = svc();
  [USER_REVOKED, USER_COMPANY_B, USER_WORKER_B] = await Promise.all([freshUser(db), freshUser(db), freshUser(db)]);

  // Ex-miembro de Los Aromos: revocado ⇒ debe caer a 0 filas. No viola el índice
  // único parcial (solo aplica a `revoked_at is null`).
  unwrap("seed member revocado", (await db.from("company_members").insert({
    tenant_id: TENANT_A, company_id: CO_LOS_AROMOS, user_id: USER_REVOKED,
    email: "revocado@t.cl", revoked_at: "2020-01-01T00:00:00.000Z",
  })).error);

  // Tenant B: empresa + miembro + una inscripción propia. Da sustancia al cruce
  // de tenants (sin esto, "company@B ve 0 de A" sería cierto por vacío).
  unwrap("seed empresa B", (await db.from("companies").insert({
    id: CO_B1, tenant_id: TENANT_B, rut: `79${Math.floor(Math.random() * 900000 + 100000)}-0`,
    razon_social: "Pesquera Demo del Sur Ltda",
  })).error);
  unwrap("seed member B", (await db.from("company_members").insert({
    tenant_id: TENANT_B, company_id: CO_B1, user_id: USER_COMPANY_B, email: "rrhh@pesquera.test",
  })).error);
  unwrap("seed curso B", (await db.from("courses").insert({
    id: COURSE_B, tenant_id: TENANT_B, name: "Curso 5.2 (tenant B)", sence: true, cod_sence: "1234567890",
  })).error);
  unwrap("seed acción B", (await db.from("actions").insert({
    id: ACTION_B, tenant_id: TENANT_B, course_id: COURSE_B, codigo_accion: "ACC-5.2-B",
    training_line: 3, environment: "rcetest",
  })).error);
  unwrap("seed inscripción B", (await db.from("enrollments").insert({
    id: ENR_B, tenant_id: TENANT_B, action_id: ACTION_B, user_id: USER_WORKER_B,
    run: "7333555-1", first_names: "Trabajador", last_names: "Tenant B", company_id: CO_B1,
  })).error);
});

afterAll(async () => {
  // Limpieza de TODO lo que esta suite sembró y la BD permite borrar. El residuo
  // en tenant A rompería a las suites que afirman sobre listas completas según el
  // orden de archivos, y en enrollments/actions falsearía los conteos por acción.
  try {
    const db = svc();
    await db.from("enrollments").delete().eq("id", ENR_B);
    await db.from("actions").delete().eq("id", ACTION_B);
    await db.from("courses").delete().eq("id", COURSE_B);
  } finally {
    // `companies` y `company_members` NO tienen DELETE para el service_role a
    // propósito (una empresa con historial SENCE no se borra; un miembro se
    // REVOCA, no se borra). Su residuo es INERTE: ids/RUT aleatorios por corrida
    // (sin colisión de unique) y ninguna otra suite lee esas dos tablas.
  }
});

describe("H4-R-008 — el rol `company` queda escopado a SU empresa", () => {
  it("★ CRUCE DENTRO DEL TENANT: solo ve a su trabajadora; ni la de otra empresa ni al particular", async () => {
    const db = await companyClient(USER_COMPANY_A);
    const { data, error } = await db.from("enrollments").select("id, company_id").eq("action_id", DEMO_ACTION);
    expect(error).toBeNull();

    // La aserción dura: la lista COMPLETA es exactamente su inscripción.
    expect((data ?? []).map((r) => r.id)).toEqual([ENR_AROMOS]);
    // Y explícitamente lo que ANTES filtraba (regresión de H4-R-008):
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(ids.has(ENR_VULCANO), "fuga cross-company: ve a la trabajadora de Vulcano").toBe(false);
    expect(ids.has(ENR_PARTICULAR), "fuga: ve al alumno particular, que no es de ninguna empresa").toBe(false);
    expect((data ?? []).every((r) => r.company_id === CO_LOS_AROMOS)).toBe(true);
  });

  it("no alcanza al alumno de otra empresa ni pidiéndolo por id (sin fuga por filtro)", async () => {
    const db = await companyClient(USER_COMPANY_A);
    for (const [label, id] of [["Vulcano", ENR_VULCANO], ["particular", ENR_PARTICULAR]] as const) {
      const { data, error } = await db.from("enrollments").select("id, run").eq("id", id);
      expect(error).toBeNull();
      expect(data ?? [], `apuntar directo al id de ${label} no debe devolver la fila`).toEqual([]);
    }
  });

  it("miembro REVOCADO ⇒ 0 filas (la revocación corta el acceso al instante)", async () => {
    const db = await companyClient(USER_REVOKED);
    const { data, error } = await db.from("enrollments").select("id");
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("rol `company` SIN vinculación a empresa ⇒ 0 filas (entra cerrado, sin backfill)", async () => {
    // El usuario `company` semilla del tenant B no tiene company_members: es el
    // estado exacto de todo usuario `company` recién migrado (deny-by-default).
    const db = await companyClient("bbbbbbbb-0000-4000-8000-000000000006", TENANT_B);
    const { data, error } = await db.from("enrollments").select("id");
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});

describe("aislamiento entre tenants (el escopado nuevo no debilita RNF-1)", () => {
  it("company@A no ve NADA del tenant B; company@B no ve NADA del tenant A", async () => {
    const a = await companyClient(USER_COMPANY_A);
    expect((await a.from("enrollments").select("id").eq("tenant_id", TENANT_B)).data ?? []).toEqual([]);
    expect((await a.from("companies").select("id").eq("tenant_id", TENANT_B)).data ?? []).toEqual([]);

    const b = await companyClient(USER_COMPANY_B, TENANT_B);
    expect((await b.from("enrollments").select("id").eq("tenant_id", TENANT_A)).data ?? []).toEqual([]);
    expect((await b.from("companies").select("id").eq("tenant_id", TENANT_A)).data ?? []).toEqual([]);
  });

  it("company@B sí ve LO SUYO (el aislamiento no es una negación global)", async () => {
    const b = await companyClient(USER_COMPANY_B, TENANT_B);
    const { data, error } = await b.from("enrollments").select("id");
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([ENR_B]);
  });

  it("un miembro de empresa NO hereda acceso en otro tenant (claim cruzado)", async () => {
    // Mismo usuario, JWT apuntando al tenant ajeno: su membresía es del tenant B.
    const cross = await companyClient(USER_COMPANY_B, TENANT_A);
    expect((await cross.from("enrollments").select("id")).data ?? []).toEqual([]);
    expect((await cross.from("companies").select("id")).data ?? []).toEqual([]);
  });
});

describe("sence_sessions — la asistencia SENCE también queda escopada", () => {
  it("solo ve las sesiones de las inscripciones de SU empresa", async () => {
    const db = await companyClient(USER_COMPANY_A);
    const { data, error } = await db.from("sence_sessions").select("id, enrollment_id");
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([SESS_AROMOS]);
    expect((data ?? []).some((r) => r.id === SESS_VULCANO), "fuga: asistencia SENCE de otra empresa").toBe(false);
    expect((data ?? []).every((r) => r.enrollment_id === ENR_AROMOS)).toBe(true);
  });

  it("no alcanza la sesión de otra empresa ni por id, ni el RUN que lleva dentro", async () => {
    const db = await companyClient(USER_COMPANY_A);
    const { data, error } = await db.from("sence_sessions").select("id, run_alumno").eq("id", SESS_VULCANO);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("miembro revocado no ve sesión alguna", async () => {
    const db = await companyClient(USER_REVOKED);
    expect((await db.from("sence_sessions").select("id")).data ?? []).toEqual([]);
  });
});

describe("notas y certificados NO se leen por tabla (llegan curados por el servicio)", () => {
  it("company no lee `grades` — ni siquiera la nota de SU PROPIA trabajadora", async () => {
    // El seed tiene una nota PUBLICADA de María José (Los Aromos). Aun así: 0.
    // `grades_select` no tiene rama company a propósito; la nota va curada por el
    // servicio del portal (parte 2).
    const db = await companyClient(USER_COMPANY_A);
    const { data, error } = await db.from("grades").select("id").eq("enrollment_id", ENR_AROMOS);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("company no lee `certificates` (el snapshot lleva el RUN completo — D-030)", async () => {
    const db = await companyClient(USER_COMPANY_A);
    const { data, error } = await db.from("certificates").select("id");
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});

describe("companies / company_members — visibilidad y solo-lectura", () => {
  it("company ve SOLO su empresa, no la otra del tenant", async () => {
    const db = await companyClient(USER_COMPANY_A);
    const { data, error } = await db.from("companies").select("id");
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([CO_LOS_AROMOS]);
    expect((data ?? []).some((r) => r.id === CO_VULCANO), "ve la razón social de otra empresa").toBe(false);
  });

  it("company ve su propia membresía, no la de la otra empresa", async () => {
    const db = await companyClient(USER_COMPANY_A);
    const { data, error } = await db.from("company_members").select("company_id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
    expect((data ?? []).every((r) => r.company_id === CO_LOS_AROMOS)).toBe(true);
  });

  it("el student NO ve empresa alguna (dato del OTEC, no del alumno)", async () => {
    const db = client(await jwt(USER_STUDENT_A, ["student"], TENANT_A));
    expect((await db.from("companies").select("id")).data ?? []).toEqual([]);
    expect((await db.from("company_members").select("id")).data ?? []).toEqual([]);
  });

  it("company NO puede escribir en companies ni en company_members (service_role only)", async () => {
    const db = await companyClient(USER_COMPANY_A);

    const insCompany = await db.from("companies").insert({ tenant_id: TENANT_A, rut: "77999888-1", razon_social: "Pirata SpA" });
    expect(insCompany.error).not.toBeNull();

    // Auto-vincularse a otra empresa sería la escalada obvia: leer a Vulcano.
    const insMember = await db.from("company_members").insert({
      tenant_id: TENANT_A, company_id: CO_VULCANO, user_id: USER_COMPANY_A, email: "pirata@t.cl",
    });
    expect(insMember.error).not.toBeNull();

    // Ni mover SU membresía a la otra empresa.
    const upd = await db.from("company_members").update({ company_id: CO_VULCANO }).eq("user_id", USER_COMPANY_A).select("id");
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);

    // Ni reetiquetar una inscripción ajena como suya.
    const updEnr = await db.from("enrollments").update({ company_id: CO_LOS_AROMOS }).eq("id", ENR_VULCANO).select("id");
    expect(updEnr.error !== null || (updEnr.data ?? []).length === 0).toBe(true);

    // Y la fuga NO ocurrió por ninguna de las vías anteriores.
    const after = await db.from("enrollments").select("id").eq("action_id", DEMO_ACTION);
    expect((after.data ?? []).map((r) => r.id)).toEqual([ENR_AROMOS]);
  });
});

describe("REGRESIÓN: el escopado de company no tocó al resto de la matriz", () => {
  it("el supervisor con grant vigente sigue viendo las inscripciones del tenant (task 3.11 intacta)", async () => {
    const db = client(await jwt(USER_SUPERVISOR_A, ["supervisor"], TENANT_A));
    const { data, error } = await db.from("enrollments").select("id").eq("action_id", DEMO_ACTION);
    expect(error).toBeNull();
    // Grant de alcance TENANT: ve a los 3 inscritos, sin importar la empresa.
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(ids.has(ENR_AROMOS)).toBe(true);
    expect(ids.has(ENR_VULCANO)).toBe(true);
    expect(ids.has(ENR_PARTICULAR)).toBe(true);
  });

  it("el staff del OTEC sigue viendo a TODOS los inscritos (la empresa no lo acota)", async () => {
    for (const role of ["otec_admin", "coordinator", "instructor", "tutor"]) {
      const db = client(await jwt(USER_STUDENT_A, [role], TENANT_A));
      const { data, error } = await db.from("enrollments").select("id").eq("action_id", DEMO_ACTION);
      expect(error, `${role} no debería recibir error`).toBeNull();
      expect((data ?? []).length, `${role} debe seguir viendo los 3 inscritos`).toBe(3);
    }
  });

  it("el alumno sigue viendo SU inscripción (la rama user_id no se tocó)", async () => {
    const db = client(await jwt(USER_STUDENT_A, ["student"], TENANT_A));
    const { data, error } = await db.from("enrollments").select("id");
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([ENR_AROMOS]);
  });
});
