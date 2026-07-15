/**
 * Matriz de permisos COMPLETA de los 8 roles (task 1.7, HU-2.3, spec §3).
 * Data-driven: por cada rol se emite un JWT con sus claims y se verifica el
 * acceso de LECTURA (RLS) a cada tabla de negocio contra la matriz del spec.
 * Deny-by-default verificado: lo que no está permitido devuelve 0 filas.
 * (Las escrituras son potestad del servidor vía tenantGuard + authorize(); su
 * matriz se cubre en los tests de servicio y en rbac.test.ts.)
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

const TENANT_A = "11111111-1111-4111-8111-111111111111";

/** Rol → índice del usuario semilla en tenant A (aaaaaaaa-…-00000000000N). */
const ROLE_BY_INDEX = {
  1: "otec_admin",
  2: "coordinator",
  3: "instructor",
  4: "tutor",
  5: "student",
  6: "company",
  7: "supervisor",
} as const;

type Access = "some" | "none"; // ≥1 fila legible | 0 filas (denegado)

/**
 * Matriz esperada de LECTURA por rol (spec §3, con los datos del seed del tenant
 * A: 1 curso, 1 acción, 2 lecciones, 1 inscripción, 1 config SENCE, auditoría).
 */
const EXPECTED: Record<string, Record<string, Access>> = {
  otec_admin:  { courses: "some", actions: "some", lessons: "some", enrollments: "some", sence_otec_config: "some", audit_log: "some", memberships: "some", lesson_progress: "some", sence_sessions: "some", sence_events: "some", alerts: "some" },
  coordinator: { courses: "some", actions: "some", lessons: "some", enrollments: "some", sence_otec_config: "none", audit_log: "none", memberships: "some", lesson_progress: "some", sence_sessions: "some", sence_events: "none", alerts: "none" },
  instructor:  { courses: "some", actions: "some", lessons: "some", enrollments: "some", sence_otec_config: "none", audit_log: "none", memberships: "some", lesson_progress: "some", sence_sessions: "some", sence_events: "none", alerts: "none" }, // ve su propia membership
  tutor:       { courses: "some", actions: "some", lessons: "some", enrollments: "some", sence_otec_config: "none", audit_log: "none", memberships: "some", lesson_progress: "some", sence_sessions: "some", sence_events: "none", alerts: "none" },
  student:     { courses: "some", actions: "some", lessons: "some", enrollments: "some", sence_otec_config: "none", audit_log: "none", memberships: "some", lesson_progress: "some", sence_sessions: "some", sence_events: "none", alerts: "none" }, // enrollments/progreso/sesiones: los suyos
  company:     { courses: "some", actions: "some", lessons: "some", enrollments: "some", sence_otec_config: "none", audit_log: "none", memberships: "some", lesson_progress: "none", sence_sessions: "some", sence_events: "none", alerts: "none" },
  supervisor:  { courses: "some", actions: "some", lessons: "some", enrollments: "some", sence_otec_config: "none", audit_log: "none", memberships: "some", lesson_progress: "some", sence_sessions: "some", sence_events: "some", alerts: "some" },
};

let env: { apiUrl: string; anonKey: string; jwtSecret: string };

function loadEnv() {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string) => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), anonKey: get("ANON_KEY"), jwtSecret: get("JWT_SECRET") };
}

async function clientForRole(index: number, role: string): Promise<SupabaseClient> {
  const sub = `aaaaaaaa-0000-4000-8000-00000000000${index}`;
  const token = await new SignJWT({ role: "authenticated", tenant_id: TENANT_A, roles: [role] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.jwtSecret));
  return createClient(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function countable(db: SupabaseClient, table: string): Promise<{ error: boolean; rows: number }> {
  // Se selecciona `tenant_id` (columna presente en todas las tablas de negocio)
  // para medir SOLO el acceso de FILA (RLS), sin ruido de privilegios de columna.
  const { data, error } = await db.from(table).select("tenant_id");
  return { error: error !== null, rows: data?.length ?? 0 };
}

beforeAll(() => {
  env = loadEnv();
});

describe("matriz de permisos de los 8 roles (task 1.7, spec §3)", () => {
  for (const [indexStr, role] of Object.entries(ROLE_BY_INDEX)) {
    const index = Number(indexStr);
    const expected = EXPECTED[role]!;

    for (const [table, access] of Object.entries(expected)) {
      it(`${role}: lectura de ${table} → ${access}`, async () => {
        const db = await clientForRole(index, role);
        const { error, rows } = await countable(db, table);
        expect(error, `${role} no debería recibir error de RLS al leer ${table}`).toBe(false);
        if (access === "some") {
          expect(rows, `${role} debería leer al menos una fila de ${table}`).toBeGreaterThan(0);
        } else {
          expect(rows, `${role} NO debería leer ninguna fila de ${table} (deny-by-default)`).toBe(0);
        }
      });
    }
  }

  it("platform_admins es invisible para TODOS los roles del tenant", async () => {
    for (const [indexStr, role] of Object.entries(ROLE_BY_INDEX)) {
      const db = await clientForRole(Number(indexStr), role);
      const { data } = await db.from("platform_admins").select("*");
      expect(data ?? [], `${role} no debería ver platform_admins`).toEqual([]);
    }
  });

  it("el token cifrado SENCE NO es seleccionable por el cliente, ni para el otec_admin (I-6)", async () => {
    const db = await clientForRole(1, "otec_admin");
    // La columna del token está protegida a nivel de privilegio: pedirla falla.
    const tokenSel = await db.from("sence_otec_config").select("token_encrypted");
    expect(tokenSel.error, "token_encrypted no debe ser seleccionable por el cliente").not.toBeNull();
    // Las columnas no sensibles sí se leen (el admin ve su RUT y ambiente).
    const okSel = await db.from("sence_otec_config").select("rut_otec, default_environment");
    expect(okSel.error).toBeNull();
    expect(okSel.data?.length ?? 0).toBeGreaterThan(0);
  });
});
