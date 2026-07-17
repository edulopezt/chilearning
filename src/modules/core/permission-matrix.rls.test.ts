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
// Semilla de la task 5.2: la empresa del usuario `company` y su única trabajadora.
const SEED_COMPANY_LOS_AROMOS = "c1000000-0000-4000-8000-000000000001";
const SEED_ENROLLMENT_LOS_AROMOS = "e0000000-0000-4000-8000-000000000001";

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
  otec_admin:  { courses: "some", actions: "some", lessons: "some", enrollments: "some", sence_otec_config: "some", audit_log: "some", memberships: "some", lesson_progress: "some", sence_sessions: "some", sence_events: "some", alerts: "some", quizzes: "some", questions: "some", quiz_attempts: "some", grades: "some", assignments: "some", submissions: "some", notifications: "none" },
  coordinator: { courses: "some", actions: "some", lessons: "some", enrollments: "some", sence_otec_config: "none", audit_log: "none", memberships: "some", lesson_progress: "some", sence_sessions: "some", sence_events: "none", alerts: "none", quizzes: "some", questions: "some", quiz_attempts: "some", grades: "some", assignments: "some", submissions: "some", notifications: "none" },
  instructor:  { courses: "some", actions: "some", lessons: "some", enrollments: "some", sence_otec_config: "none", audit_log: "none", memberships: "some", lesson_progress: "some", sence_sessions: "some", sence_events: "none", alerts: "none", quizzes: "some", questions: "some", quiz_attempts: "some", grades: "some", assignments: "some", submissions: "some", notifications: "none" }, // ve su propia membership
  tutor:       { courses: "some", actions: "some", lessons: "some", enrollments: "some", sence_otec_config: "none", audit_log: "none", memberships: "some", lesson_progress: "some", sence_sessions: "some", sence_events: "none", alerts: "none", quizzes: "some", questions: "some", quiz_attempts: "some", grades: "some", assignments: "some", submissions: "some", notifications: "none" },
  student:     { courses: "some", actions: "some", lessons: "some", enrollments: "some", sence_otec_config: "none", audit_log: "none", memberships: "some", lesson_progress: "some", sence_sessions: "some", sence_events: "none", alerts: "none", quizzes: "some", questions: "none", quiz_attempts: "some", grades: "some", assignments: "some", submissions: "some", notifications: "none" }, // publicado/lo suyo; questions JAMÁS (pauta); notifications: solo si tiene alguna
  // ⚠ `company` es el único rol cuyo acceso NO se describe por completo con
  // some/none: desde la task 5.2 está ESCOPADO a su empresa (H4-R-008). Aquí
  // "some" solo dice "ve algo" — que vea SOLO lo suyo lo fija el test dedicado de
  // más abajo y, exhaustivamente, company.rls.test.ts. No relajar a "some" sin
  // leer eso: con el hueco abierto esta fila también pasaba en verde.
  company:     { courses: "some", actions: "some", lessons: "some", enrollments: "some", sence_otec_config: "none", audit_log: "none", memberships: "some", lesson_progress: "none", sence_sessions: "some", sence_events: "none", alerts: "none", quizzes: "some", questions: "none", quiz_attempts: "none", grades: "none", assignments: "some", submissions: "none", notifications: "none" },
  supervisor:  { courses: "some", actions: "some", lessons: "some", enrollments: "some", sence_otec_config: "none", audit_log: "none", memberships: "some", lesson_progress: "some", sence_sessions: "some", sence_events: "some", alerts: "some", quizzes: "some", questions: "none", quiz_attempts: "none", grades: "some", assignments: "some", submissions: "none", notifications: "none" },
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

  it("el 'some' de company es ESCOPADO a su empresa, no plano (H4-R-008)", async () => {
    // La matriz es de grano grueso (some/none) y por eso NO habría detectado el
    // hueco: con `has_role('company')` plano el rol veía a los 3 inscritos del
    // tenant — y esta suite igual pasaba. Se fija el conteo contra el seed
    // (Los Aromos: 1 trabajadora; Vulcano: 1; particular: 1).
    const db = await clientForRole(6, "company");

    const enr = await db.from("enrollments").select("id, company_id");
    expect(enr.error).toBeNull();
    expect(enr.data ?? [], "company debe ver SOLO a su trabajadora, no a los 3 del tenant").toHaveLength(1);
    expect(enr.data?.[0]?.company_id).toBe(SEED_COMPANY_LOS_AROMOS);

    const sessions = await db.from("sence_sessions").select("enrollment_id");
    expect(sessions.error).toBeNull();
    expect(sessions.data ?? [], "company debe ver SOLO la asistencia SENCE de su empresa").toHaveLength(1);
    expect(sessions.data?.[0]?.enrollment_id).toBe(SEED_ENROLLMENT_LOS_AROMOS);
  });

  it("platform_admins es invisible para TODOS los roles del tenant", async () => {
    for (const [indexStr, role] of Object.entries(ROLE_BY_INDEX)) {
      const db = await clientForRole(Number(indexStr), role);
      const { data } = await db.from("platform_admins").select("*");
      expect(data ?? [], `${role} no debería ver platform_admins`).toEqual([]);
    }
  });

  it("la PAUTA del intento (answer_key) NO es seleccionable por el cliente, ni por el propio alumno", async () => {
    // Mismo mecanismo que token_encrypted: grant de columnas (task 2.1, S7).
    for (const [indexStr, role] of Object.entries(ROLE_BY_INDEX)) {
      const db = await clientForRole(Number(indexStr), role);
      const withKey = await db.from("quiz_attempts").select("answer_key");
      expect(withKey.error, `${role} no debe poder seleccionar answer_key`).not.toBeNull();
    }
    // Las columnas no sensibles del intento sí se leen (el alumno ve su snapshot).
    const student = await clientForRole(5, "student");
    const okSel = await student.from("quiz_attempts").select("questions_snapshot, grade");
    expect(okSel.error).toBeNull();
    expect(okSel.data?.length ?? 0).toBeGreaterThan(0);
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
