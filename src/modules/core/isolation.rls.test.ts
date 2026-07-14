/**
 * Suite de aislamiento multi-tenant (RNF-1, P2) — task 0.2.
 * Intenta leer/escribir CRUZADO entre los dos tenants semilla con cada rol;
 * cualquier fuga rompe el build. Requiere `supabase start` + `supabase db reset`.
 *
 * Los JWT se firman aquí mismo con el secreto local (los claims tenant_id/roles
 * los inyectará el Auth Hook en la task 0.4; las policies ya los exigen).
 */
import { execSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const SUPERADMIN_ID = "00000000-0000-4000-8000-00000000000a";

const TENANT_ROLES = [
  "otec_admin",
  "coordinator",
  "instructor",
  "tutor",
  "student",
  "company",
  "supervisor",
] as const;
type TenantRole = (typeof TENANT_ROLES)[number];

/** user_id determinista del seed: prefijo del tenant + índice del rol. */
function seedUserId(tenant: "a" | "b", role: TenantRole): string {
  const idx = TENANT_ROLES.indexOf(role) + 1;
  const prefix = tenant === "a" ? "aaaaaaaa" : "bbbbbbbb";
  return `${prefix}-0000-4000-8000-00000000000${idx}`;
}

interface LocalEnv {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  jwtSecret: string;
}

function loadLocalEnv(): LocalEnv {
  const fromEnv = {
    apiUrl: process.env.SUPABASE_API_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    jwtSecret: process.env.SUPABASE_JWT_SECRET,
  };
  if (fromEnv.apiUrl && fromEnv.anonKey && fromEnv.serviceRoleKey && fromEnv.jwtSecret) {
    return fromEnv as LocalEnv;
  }
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (key: string): string => {
    const match = out.match(new RegExp(`^${key}="?([^"\\r\\n]+)"?$`, "m"));
    if (!match?.[1]) throw new Error(`supabase status no expone ${key}; ¿está corriendo supabase start?`);
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

async function mintJwt(claims: {
  sub: string;
  tenant_id?: string;
  roles?: string[];
}): Promise<string> {
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

async function clientAs(tenant: "a" | "b", role: TenantRole): Promise<SupabaseClient> {
  const token = await mintJwt({
    sub: seedUserId(tenant, role),
    tenant_id: tenant === "a" ? TENANT_A : TENANT_B,
    roles: [role],
  });
  return clientFor(token);
}

beforeAll(() => {
  env = loadLocalEnv();
});

describe("aislamiento multi-tenant (RNF-1): cada rol contra el tenant ajeno", () => {
  for (const role of TENANT_ROLES) {
    it(`${role}@A ve SOLO su tenant en tenants`, async () => {
      const db = await clientAs("a", role);
      const { data, error } = await db.from("tenants").select("id");
      expect(error).toBeNull();
      expect(data?.map((r) => r.id)).toEqual([TENANT_A]);
    });

    it(`${role}@A no lee memberships del tenant B`, async () => {
      const db = await clientAs("a", role);
      const { data, error } = await db
        .from("memberships")
        .select("id")
        .eq("tenant_id", TENANT_B);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it(`${role}@A no puede insertar membership en el tenant B`, async () => {
      const db = await clientAs("a", role);
      const { error } = await db.from("memberships").insert({
        tenant_id: TENANT_B,
        user_id: seedUserId("a", "student"),
        roles: ["student"],
      });
      expect(error).not.toBeNull();
    });

    it(`${role}@A no puede escribir audit_log del tenant B`, async () => {
      const db = await clientAs("a", role);
      const { error } = await db.from("audit_log").insert({
        tenant_id: TENANT_B,
        actor_user_id: seedUserId("a", role),
        action: "rls.test.cross",
      });
      expect(error).not.toBeNull();
    });

    it(`${role}@A SÍ escribe audit_log de su propio tenant (P8)`, async () => {
      const db = await clientAs("a", role);
      const { error } = await db.from("audit_log").insert({
        tenant_id: TENANT_A,
        actor_user_id: seedUserId("a", role),
        action: "rls.test.own",
      });
      expect(error).toBeNull();
    });

    it(`${role}@A no puede actualizar memberships del tenant B (0 filas)`, async () => {
      const db = await clientAs("a", role);
      const { data, error } = await db
        .from("memberships")
        .update({ status: "active" })
        .eq("tenant_id", TENANT_B)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  }

  it("un JWT sin claims (sin Auth Hook) no ve NADA: deny-by-default (P7)", async () => {
    const token = await mintJwt({ sub: seedUserId("a", "student") });
    const db = clientFor(token);
    const tenants = await db.from("tenants").select("id");
    const memberships = await db.from("memberships").select("id");
    expect(tenants.data).toEqual([]);
    expect(memberships.data).toEqual([]);
  });

  it("anon no ve nada (sin privilegios siquiera: deny-by-default)", async () => {
    const db = clientFor();
    const { data, error } = await db.from("tenants").select("id");
    // anon no tiene GRANT alguno: 42501, y jamás filas.
    expect(error).not.toBeNull();
    expect(data ?? []).toEqual([]);
  });
});

describe("matriz de permisos dentro del tenant", () => {
  it("superadmin ve ambos tenants", async () => {
    const token = await mintJwt({ sub: SUPERADMIN_ID, roles: ["superadmin"] });
    const db = clientFor(token);
    const { data, error } = await db.from("tenants").select("id");
    expect(error).toBeNull();
    expect(data?.map((r) => r.id).sort()).toEqual([TENANT_A, TENANT_B]);
  });

  it("otec_admin@A lee la auditoría de su tenant (solo filas de A)", async () => {
    const db = await clientAs("a", "otec_admin");
    const { data, error } = await db.from("audit_log").select("tenant_id");
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
    expect(data?.every((r) => r.tenant_id === TENANT_A)).toBe(true);
  });

  it("student@A NO lee la auditoría (matriz spec §3)", async () => {
    const db = await clientAs("a", "student");
    const { data, error } = await db.from("audit_log").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("student@A no ve memberships ajenas, solo la suya", async () => {
    const db = await clientAs("a", "student");
    const { data, error } = await db.from("memberships").select("user_id");
    expect(error).toBeNull();
    expect(data).toEqual([{ user_id: seedUserId("a", "student") }]);
  });
});

describe("escalada de privilegios dentro del propio tenant (hallazgo C1)", () => {
  it("coordinator NO puede asignarse el rol superadmin", async () => {
    const db = await clientAs("a", "coordinator");
    const { error } = await db
      .from("memberships")
      .update({ roles: ["superadmin"] })
      .eq("user_id", seedUserId("a", "coordinator"));
    expect(error).not.toBeNull();
  });

  it("coordinator NO puede asignarse el rol otec_admin", async () => {
    const db = await clientAs("a", "coordinator");
    const { error } = await db
      .from("memberships")
      .update({ roles: ["otec_admin"] })
      .eq("user_id", seedUserId("a", "coordinator"));
    expect(error).not.toBeNull();
  });

  it("coordinator NO puede crear una membership con rol otec_admin", async () => {
    const db = await clientAs("a", "coordinator");
    const { error } = await db.from("memberships").insert({
      tenant_id: TENANT_A,
      user_id: SUPERADMIN_ID,
      roles: ["otec_admin"],
    });
    expect(error).not.toBeNull();
  });

  it("ni siquiera un otec_admin puede crear una membership superadmin", async () => {
    const db = await clientAs("a", "otec_admin");
    const { error } = await db.from("memberships").insert({
      tenant_id: TENANT_A,
      user_id: SUPERADMIN_ID,
      roles: ["superadmin"],
    });
    expect(error).not.toBeNull();
  });

  it("otec_admin SÍ puede crear una membership normal en su tenant", async () => {
    const db = await clientAs("a", "otec_admin");
    const { error } = await db.from("memberships").insert({
      tenant_id: TENANT_A,
      user_id: SUPERADMIN_ID,
      roles: ["student"],
    });
    expect(error).toBeNull();
  });

  it("otec_admin no puede mover su membership a otro tenant (robo de usuario)", async () => {
    const db = await clientAs("a", "otec_admin");
    const { data, error } = await db
      .from("memberships")
      .update({ tenant_id: TENANT_B })
      .eq("user_id", seedUserId("a", "otec_admin"))
      .select("id");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("otec_admin no puede crear ni editar tenants (privilegio no otorgado)", async () => {
    const db = await clientAs("a", "otec_admin");
    const insert = await db
      .from("tenants")
      .insert({ slug: "otec-pirata", name: "Pirata" });
    expect(insert.error).not.toBeNull();

    const update = await db
      .from("tenants")
      .update({ name: "Renombrado" })
      .eq("id", TENANT_A)
      .select("id");
    expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);
  });

  it("otec_admin no puede borrar memberships del tenant B", async () => {
    const db = await clientAs("a", "otec_admin");
    const { data, error } = await db
      .from("memberships")
      .delete()
      .eq("tenant_id", TENANT_B)
      .select("id");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});

describe("robustez de los claims (deny limpio, sin reventar)", () => {
  it("un tenant_id malformado deniega en vez de lanzar 22P02", async () => {
    const token = await new SignJWT({
      role: "authenticated",
      tenant_id: "no-soy-un-uuid",
      roles: ["otec_admin"],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(seedUserId("a", "otec_admin"))
      .setAudience("authenticated")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(env.jwtSecret));
    const db = clientFor(token);
    const { data, error } = await db.from("tenants").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("un claim roles que no es array no rompe las policies", async () => {
    const token = await new SignJWT({
      role: "authenticated",
      tenant_id: TENANT_A,
      roles: "otec_admin",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(seedUserId("a", "otec_admin"))
      .setAudience("authenticated")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(env.jwtSecret));
    const db = clientFor(token);
    const { data, error } = await db.from("audit_log").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe("audit_log es INSERT-only incluso con privilegios (P8)", () => {
  it("el superadmin no puede falsear el actor de un evento de plataforma", async () => {
    const token = await mintJwt({ sub: SUPERADMIN_ID, roles: ["superadmin"] });
    const db = clientFor(token);
    const { error } = await db.from("audit_log").insert({
      tenant_id: null,
      actor_user_id: seedUserId("a", "otec_admin"),
      action: "platform.spoofed",
    });
    expect(error).not.toBeNull();
  });

  it("otec_admin no puede UPDATE audit_log (privilegio revocado)", async () => {
    const db = await clientAs("a", "otec_admin");
    const { error } = await db
      .from("audit_log")
      .update({ action: "tampered" })
      .eq("tenant_id", TENANT_A);
    expect(error).not.toBeNull();
  });

  it("otec_admin no puede DELETE audit_log (privilegio revocado)", async () => {
    const db = await clientAs("a", "otec_admin");
    const { error } = await db.from("audit_log").delete().eq("tenant_id", TENANT_A);
    expect(error).not.toBeNull();
  });

  it("ni siquiera el service role puede UPDATE audit_log", async () => {
    const db = createClient(env.apiUrl, env.serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { error } = await db
      .from("audit_log")
      .update({ action: "tampered" })
      .eq("tenant_id", TENANT_A);
    expect(error).not.toBeNull();
  });

  it("ni siquiera el service role puede DELETE audit_log", async () => {
    const db = createClient(env.apiUrl, env.serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { error } = await db.from("audit_log").delete().eq("tenant_id", TENANT_A);
    expect(error).not.toBeNull();
  });
});

describe("service role (documenta por qué tenantGuard() es obligatorio)", () => {
  it("el service role bypassa RLS y ve TODO — por eso JAMÁS se usa sin tenantGuard()", async () => {
    const db = createClient(env.apiUrl, env.serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await db.from("memberships").select("tenant_id");
    expect(error).toBeNull();
    const tenants = new Set(data?.map((r) => r.tenant_id));
    expect(tenants.has(TENANT_A)).toBe(true);
    expect(tenants.has(TENANT_B)).toBe(true);
  });
});
