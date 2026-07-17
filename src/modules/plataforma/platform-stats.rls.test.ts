/**
 * RLS de las métricas de plataforma (task 5.5, HU-10.3): `platform_tenant_stats`
 * es potestad EXCLUSIVA del superadmin y devuelve SOLO agregados.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const SUPERADMIN_ID = "00000000-0000-4000-8000-00000000000a";

/** Roles de tenant que JAMÁS deben ver métricas de plataforma. */
const DENIED_ROLES = ["otec_admin", "student", "company", "supervisor"] as const;
type DeniedRole = (typeof DENIED_ROLES)[number];

/** user_id determinista del seed (mismo esquema que isolation.rls.test.ts). */
const ROLE_INDEX: Record<DeniedRole, number> = {
  otec_admin: 1,
  student: 5,
  company: 6,
  supervisor: 7,
};

/**
 * Contrato de FORMA del retorno: exactamente estas claves, ni una más. Es la
 * defensa del "no PII" (spec §3) ante regresiones: si alguien agrega
 * `student_name`, `run` o `email` a la RPC, este test se cae.
 */
const EXPECTED_KEYS = [
  "actions",
  "certificates",
  "courses",
  "created_at",
  "enrollments",
  "last_enrollment_at",
  "name",
  "open_alerts",
  "plan",
  "sence_error_alerts_7d",
  "slug",
  "status",
  "students",
  "tenant_id",
] as const;

interface LocalEnv {
  apiUrl: string;
  anonKey: string;
  jwtSecret: string;
}

function loadLocalEnv(): LocalEnv {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (key: string): string => {
    const match = out.match(new RegExp(`^${key}="?([^"\\r\\n]+)"?$`, "m"));
    if (!match?.[1]) throw new Error(`supabase status no expone ${key}; ¿está corriendo supabase start?`);
    return match[1];
  };
  return { apiUrl: get("API_URL"), anonKey: get("ANON_KEY"), jwtSecret: get("JWT_SECRET") };
}

let env: LocalEnv;

async function mintJwt(claims: { sub: string; tenant_id?: string; roles?: string[] }): Promise<string> {
  return new SignJWT({
    role: "authenticated",
    ...(claims.tenant_id ? { tenant_id: claims.tenant_id } : {}),
    roles: claims.roles ?? [],
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.jwtSecret));
}

function clientFor(token?: string): SupabaseClient {
  return createClient(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });
}

async function clientAs(role: DeniedRole): Promise<SupabaseClient> {
  const token = await mintJwt({
    sub: `aaaaaaaa-0000-4000-8000-00000000000${ROLE_INDEX[role]}`,
    tenant_id: TENANT_A,
    roles: [role],
  });
  return clientFor(token);
}

async function superadminClient(): Promise<SupabaseClient> {
  // Sin tenant_id: el superadmin no pertenece a ninguna OTEC (D-006).
  return clientFor(await mintJwt({ sub: SUPERADMIN_ID, roles: ["superadmin"] }));
}

beforeAll(() => {
  env = loadLocalEnv();
});

describe("platform_tenant_stats: solo superadmin (gate 42501)", () => {
  for (const role of DENIED_ROLES) {
    it(`${role}@A NO puede invocar la RPC (42501)`, async () => {
      const db = await clientAs(role);
      const { data, error } = await db.rpc("platform_tenant_stats");
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    });
  }

  it("anon NO puede invocar la RPC (sin GRANT de execute)", async () => {
    const { data, error } = await clientFor().rpc("platform_tenant_stats");
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("un JWT sin claims tampoco (deny-by-default, P7)", async () => {
    const db = clientFor(await mintJwt({ sub: SUPERADMIN_ID }));
    const { error } = await db.rpc("platform_tenant_stats");
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("un claim roles que no es array no abre la puerta", async () => {
    const token = await new SignJWT({ role: "authenticated", roles: "superadmin" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(SUPERADMIN_ID)
      .setAudience("authenticated")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(env.jwtSecret));
    const { error } = await clientFor(token).rpc("platform_tenant_stats");
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });
});

describe("platform_tenant_stats: el superadmin ve la plataforma completa", () => {
  it("devuelve filas de ambos tenants (A y B)", async () => {
    const db = await superadminClient();
    const { data, error } = await db.rpc("platform_tenant_stats");
    expect(error).toBeNull();
    const ids = (data as { tenant_id: string }[]).map((r) => r.tenant_id);
    expect(ids).toContain(TENANT_A);
    expect(ids).toContain(TENANT_B);
  });

  it("SOLO agregados: las claves son EXACTAMENTE las esperadas (no PII)", async () => {
    const db = await superadminClient();
    const { data, error } = await db.rpc("platform_tenant_stats");
    expect(error).toBeNull();
    const rows = data as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([...EXPECTED_KEYS]);
    }
  });

  it("los conteos son numéricos y no negativos", async () => {
    const db = await superadminClient();
    const { data } = await db.rpc("platform_tenant_stats");
    const rows = data as Record<string, unknown>[];
    const counters = [
      "students",
      "enrollments",
      "actions",
      "courses",
      "certificates",
      "open_alerts",
      "sence_error_alerts_7d",
    ];
    for (const row of rows) {
      for (const key of counters) {
        expect(Number(row[key])).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("el tenant semilla A reporta el uso del curso demo (agregado coherente)", async () => {
    const db = await superadminClient();
    const { data } = await db.rpc("platform_tenant_stats");
    const a = (data as Record<string, unknown>[]).find((r) => r.tenant_id === TENANT_A);
    expect(a).toBeDefined();
    // El seed deja al menos un curso, una acción y una inscripción en A.
    expect(Number(a!.courses)).toBeGreaterThanOrEqual(1);
    expect(Number(a!.actions)).toBeGreaterThanOrEqual(1);
    expect(Number(a!.enrollments)).toBeGreaterThanOrEqual(1);
    // `students` cuenta alumnos ÚNICOS: nunca supera a las inscripciones.
    expect(Number(a!.students)).toBeLessThanOrEqual(Number(a!.enrollments));
  });
});
