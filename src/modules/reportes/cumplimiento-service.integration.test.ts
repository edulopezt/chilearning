/**
 * Integración del panel de cumplimiento + export (task 2.4, HU-5.5) contra
 * Supabase local: matriz por rol (admin/coordinador/supervisor SÍ; student e
 * instructor NO), aislamiento cross-tenant, orden del export y mapeo
 * anti-inversión I-10. Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "@/modules/core/domain/rbac";
import {
  getComplianceExport,
  getCompliancePanel,
  listComplianceActions,
} from "@/modules/reportes/cumplimiento-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const USER_STUDENT = "aaaaaaaa-0000-4000-8000-000000000005";
const USER_TUTOR = "aaaaaaaa-0000-4000-8000-000000000004";

const admin: Principal = {
  userId: "aaaaaaaa-0000-4000-8000-000000000001",
  tenantId: TENANT_A,
  roles: ["otec_admin"],
};
const supervisor: Principal = {
  userId: "aaaaaaaa-0000-4000-8000-000000000007",
  tenantId: TENANT_A,
  roles: ["supervisor"],
};
const student: Principal = { userId: USER_STUDENT, tenantId: TENANT_A, roles: ["student"] };
const otherAdmin: Principal = {
  userId: "bbbbbbbb-0000-4000-8000-000000000001",
  tenantId: TENANT_B,
  roles: ["otec_admin"],
};

let svc: SupabaseClient;
let courseId = "";
let actionId = "";
let codigo = "";

function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => {
    const m = out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"));
    if (!m?.[1]) throw new Error(`falta ${k}`);
    return m[1];
  };
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

async function seedSession(input: {
  enrollmentId: string;
  status: string;
  openedAt?: string | null;
  idSesionSence?: string | null;
  run: string;
}): Promise<void> {
  const { error } = await svc.from("sence_sessions").insert({
    tenant_id: TENANT_A,
    enrollment_id: input.enrollmentId,
    action_code: codigo,
    sence_course_code: "1237999888",
    training_line: 3,
    run_alumno: input.run,
    id_sesion_alumno: `cmp-${randomUUID()}`,
    environment: "rcetest",
    status: input.status,
    opened_at: input.openedAt ?? null,
    id_sesion_sence: input.idSesionSence ?? null,
    closed_at: input.status === "cerrada" ? new Date().toISOString() : null,
  });
  if (error) throw new Error(`seed sesión: ${error.message}`);
}

beforeAll(async () => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });

  // Fixture propio: curso + acción con fechas que INCLUYEN hoy + 3 inscritos.
  courseId = randomUUID();
  await svc.from("courses").insert({
    id: courseId,
    tenant_id: TENANT_A,
    name: "Curso cumplimiento",
    sence: true,
    cod_sence: "1237999888",
  });
  actionId = randomUUID();
  codigo = `CMP-${randomUUID().slice(0, 8)}`;
  const today = new Date().toISOString().slice(0, 10);
  await svc.from("actions").insert({
    id: actionId,
    tenant_id: TENANT_A,
    course_id: courseId,
    codigo_accion: codigo,
    training_line: 3,
    environment: "rcetest",
    starts_on: today,
    ends_on: today,
  });

  const e1 = randomUUID();
  const e2 = randomUUID();
  await svc.from("enrollments").insert([
    {
      id: e1,
      tenant_id: TENANT_A,
      action_id: actionId,
      user_id: USER_STUDENT,
      run: "5126663-3",
      exento: false,
      first_names: "Ana",
      last_names: "Díaz Rojas",
    },
    {
      id: e2,
      tenant_id: TENANT_A,
      action_id: actionId,
      user_id: USER_TUTOR,
      run: "16032460-0",
      exento: true,
      first_names: "Beto",
      last_names: null,
    },
  ]);

  // Ana: una cerrada AYER-hoy (dos aperturas, la de hoy más reciente) + evento de error.
  const now = Date.now();
  await seedSession({
    enrollmentId: e1,
    status: "cerrada",
    openedAt: new Date(now - 60_000).toISOString(),
    idSesionSence: "111222",
    run: "5126663-3",
  });
  await seedSession({
    enrollmentId: e1,
    status: "error",
    openedAt: new Date(now).toISOString(),
    idSesionSence: "111223",
    run: "5126663-3",
  });
  // Evento de error ligado a una sesión de la acción (para "errores frecuentes").
  const { data: sess } = await svc
    .from("sence_sessions")
    .select("id")
    .eq("action_code", codigo)
    .limit(1)
    .single();
  await svc.from("sence_events").insert({
    tenant_id: TENANT_A,
    session_id: sess!.id as string,
    kind: "start_error",
    payload: {},
    error_codes: ["207", "204"],
    dedupe_hash: `cmp-${randomUUID()}`,
  });
});

describe("getCompliancePanel — permisos y contenido", () => {
  it("admin y supervisor ven el panel; student NO; cross-tenant NO", async () => {
    const forAdmin = await getCompliancePanel(admin, actionId);
    const forSupervisor = await getCompliancePanel(supervisor, actionId);
    expect(forAdmin).not.toBeNull();
    expect(forSupervisor).not.toBeNull();
    expect(await getCompliancePanel(student, actionId)).toBeNull();
    expect(await getCompliancePanel(otherAdmin, actionId)).toBeNull();
  });

  it("la matriz trae a los 2 inscritos, el exento sin huecos, y los errores frecuentes", async () => {
    const panel = await getCompliancePanel(admin, actionId);
    if (!panel) throw new Error("panel nulo");
    expect(panel.codigoAccion).toBe(codigo);
    expect(panel.rows).toHaveLength(2);

    const ana = panel.rows.find((r) => r.run === "5126663-3");
    const beto = panel.rows.find((r) => r.run === "16032460-0");
    expect(ana?.apellidos).toBe("Díaz Rojas");
    // Hoy es día hábil o no: si hay días, Ana tiene su cierre contabilizado.
    if (panel.days.length > 0) {
      expect(ana?.cells.some((c) => c.status === "cerrada")).toBe(true);
      expect(beto?.cells.every((c) => c.status === "exento")).toBe(true);
    }
    expect(beto?.gaps).toEqual([]);

    const top = panel.frequentErrors.map((e) => e.code);
    expect(top).toContain("207");
    expect(top).toContain("204");
  });
});

describe("getComplianceExport — réplica del reporte del plugin", () => {
  it("ordena por apertura DESC y mapea las columnas SIN invertir (I-10)", async () => {
    const result = await getComplianceExport(admin, actionId);
    if (!result) throw new Error("export nulo");
    expect(result.filename).toContain("asistencia_sence-accion_");
    expect(result.rows.length).toBeGreaterThanOrEqual(2);

    // Orden: la sesión más reciente (error de hoy) primero.
    expect(result.rows[0]?.idSesionSence).toBe("111223");
    // Anti-inversión I-10: idSence = código de la ACCIÓN; codigoCurso = CodSence.
    expect(result.rows[0]?.idSence).toBe(codigo);
    expect(result.rows[0]?.codigoCurso).toBe("1237999888");
    expect(result.rows[0]?.nombres).toBe("Ana");
    expect(result.rows[0]?.apellidos).toBe("Díaz Rojas");
    // Formato del plugin d-m-Y H:i:s.
    expect(result.rows[0]?.fechaHora).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
  });

  it("supervisor puede exportar (descarga = lectura); student no", async () => {
    expect(await getComplianceExport(supervisor, actionId)).not.toBeNull();
    expect(await getComplianceExport(student, actionId)).toBeNull();
  });
});

describe("listComplianceActions", () => {
  it("incluye la acción del fixture con su curso y conteo de inscritos", async () => {
    const list = await listComplianceActions(admin);
    const mine = list.find((a) => a.actionId === actionId);
    expect(mine).toMatchObject({
      codigoAccion: codigo,
      courseName: "Curso cumplimiento",
      enrolled: 2,
    });
    // Deny-by-default.
    expect(await listComplianceActions(student)).toEqual([]);
  });
});
