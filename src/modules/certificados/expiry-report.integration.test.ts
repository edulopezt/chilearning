/**
 * Integración del listado de vencimientos (task 5.12, HU-7.3) contra Supabase
 * local. Lo que fija:
 *  - el filtro por empresa devuelve SOLO a esa empresa (la CA es "por empresa");
 *  - la ventana acota hacia el futuro pero NUNCA esconde lo ya vencido;
 *  - el export XLSX sale saneado contra inyección de fórmulas (D-021) y sin RUN
 *    completo;
 *  - el enlace de re-inscripción apunta a OTRA acción del mismo curso;
 *  - el portal de la empresa ve solo lo SUYO (gate de 5.2 + HU-8.1).
 *
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildExpirationsXlsx, listExpirations } from "@/modules/certificados/expiry-report-service";
import type { Principal } from "@/modules/core/domain/rbac";
import { listCompanyExpirations } from "@/modules/portal-empresa/company-portal-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const admin: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };
const student: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000005", tenantId: TENANT_A, roles: ["student"] };

const NOW = Date.parse("2026-07-17T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const LABELS = { particular: "Particular", expired: "VENCIDO" };

// Fixtures FICTICIOS con ids frescos por corrida.
const COURSE = randomUUID();
const ACTION_OLD = randomUUID();  // la que certificó
const ACTION_NEW = randomUUID();  // la nueva versión: destino de re-inscripción
const CO_UNO = randomUUID();
const CO_DOS = randomUUID();
/** Nombre HOSTIL: el roster es entrada de terceros (D-021). */
const EVIL_NAME = "=cmd|' /C calc'!A0";

let svc: SupabaseClient;
let rrhh: Principal;
const certIds: Record<string, string> = {};
const seeded = { enrollments: [] as string[], users: [] as string[] };

function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}
function unwrap(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`${label}: ${error.message}`);
}
async function freshUser(): Promise<string> {
  const { data, error } = await svc.auth.admin.createUser({
    email: `rep-${randomUUID().slice(0, 12)}@t.cl`, email_confirm: true, password: `Rp-${randomUUID()}`,
  });
  if (error || !data?.user) throw new Error(`createUser: ${error?.message ?? "sin id"}`);
  seeded.users.push(data.user.id);
  return data.user.id;
}

/** Inscripción + certificado con vencimiento a `daysFromNow`. */
async function seedCert(opts: {
  key: string; companyId: string | null; daysFromNow: number | null;
  firstNames: string; lastNames: string; run: string; actionId?: string;
}): Promise<void> {
  const userId = await freshUser();
  const enrollmentId = randomUUID();
  unwrap(`inscripción ${opts.key}`, (await svc.from("enrollments").insert({
    id: enrollmentId, tenant_id: TENANT_A, action_id: opts.actionId ?? ACTION_OLD, user_id: userId,
    run: opts.run, first_names: opts.firstNames, last_names: opts.lastNames, company_id: opts.companyId,
  })).error);
  seeded.enrollments.push(enrollmentId);

  const certId = randomUUID();
  certIds[opts.key] = certId;
  unwrap(`certificado ${opts.key}`, (await svc.from("certificates").insert({
    id: certId, tenant_id: TENANT_A, enrollment_id: enrollmentId, action_id: opts.actionId ?? ACTION_OLD,
    course_id: COURSE, folio: `CERT-REP-${randomUUID().slice(0, 8)}`,
    verification_token: randomUUID().replace(/-/g, ""),
    snapshot: { studentName: `${opts.lastNames}, ${opts.firstNames}`, run: opts.run },
    expires_at: opts.daysFromNow === null ? null : new Date(NOW + opts.daysFromNow * DAY_MS).toISOString(),
  })).error);
}

beforeAll(async () => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });

  unwrap("curso", (await svc.from("courses").insert({
    id: COURSE, tenant_id: TENANT_A, name: "Manejo de sustancias peligrosas", sence: false, hours: 16, validity_months: 12,
  })).error);
  // Dos acciones del MISMO curso: la vieja certifica, la nueva es el destino de
  // recertificación (lo que hace real el "enlace directo a re-inscripción").
  unwrap("acción vieja", (await svc.from("actions").insert({
    id: ACTION_OLD, tenant_id: TENANT_A, course_id: COURSE, codigo_accion: `REP-OLD-${randomUUID().slice(0, 5)}`,
    training_line: 3, environment: "rcetest", starts_on: "2025-03-01",
  })).error);
  unwrap("acción nueva", (await svc.from("actions").insert({
    id: ACTION_NEW, tenant_id: TENANT_A, course_id: COURSE, codigo_accion: `REP-NEW-${randomUUID().slice(0, 5)}`,
    training_line: 3, environment: "rcetest", starts_on: "2026-09-01",
  })).error);

  unwrap("empresa 1", (await svc.from("companies").insert({
    id: CO_UNO, tenant_id: TENANT_A, rut: `76${Math.floor(Math.random() * 900000 + 100000)}-0`, razon_social: "Constructora Demo Uno SpA",
  })).error);
  unwrap("empresa 2", (await svc.from("companies").insert({
    id: CO_DOS, tenant_id: TENANT_A, rut: `77${Math.floor(Math.random() * 900000 + 100000)}-0`, razon_social: "Minera Demo Dos Ltda",
  })).error);

  await seedCert({ key: "uno_60", companyId: CO_UNO, daysFromNow: 60, firstNames: "Ana", lastNames: "Silva Rojas", run: "5126663-3" });
  // El nombre hostil va en la empresa UNO (así aparece en el export filtrado) y
  // en APELLIDOS, no en nombres: la celda es "Apellidos, Nombres", así que solo
  // desde el apellido el `=` queda en la POSICIÓN 0, que es la única que Excel
  // evalúa. (Con el hostil en `firstNames` la celda sale "Pérez, =cmd…" y es
  // inofensiva por construcción — el test pasaría sin probar nada.)
  await seedCert({ key: "uno_evil", companyId: CO_UNO, daysFromNow: 20, firstNames: "Nicolás", lastNames: EVIL_NAME, run: "16032460-0" });
  await seedCert({ key: "dos_45", companyId: CO_DOS, daysFromNow: 45, firstNames: "Carlos", lastNames: "Muñoz Díaz", run: "9876543-3" });
  await seedCert({ key: "particular_10", companyId: null, daysFromNow: 10, firstNames: "Rodrigo", lastNames: "Vera Soto", run: "13579246-8" });
  await seedCert({ key: "uno_vencido", companyId: CO_UNO, daysFromNow: -12, firstNames: "Elena", lastNames: "Toro Lagos", run: "11222333-4" });
  // Sin vigencia: NUNCA debe aparecer en el listado de vencimientos.
  await seedCert({ key: "sin_vigencia", companyId: CO_UNO, daysFromNow: null, firstNames: "Sofía", lastNames: "Nunca Vence", run: "12121212-1" });

  // RRHH de la empresa UNO (para el portal de la empresa).
  const rrhhUser = await freshUser();
  unwrap("miembro empresa", (await svc.from("company_members").insert({
    tenant_id: TENANT_A, company_id: CO_UNO, user_id: rrhhUser, email: "rrhh@demo-uno.cl",
  })).error);
  rrhh = { userId: rrhhUser, tenantId: TENANT_A, roles: ["company"] };
});

afterAll(async () => {
  // `certificates` no tiene DELETE ni para el service_role (ledger, P8) y su FK
  // `restrict` bloquea borrar inscripción/acción/curso. El residuo es INERTE:
  // ids ALEATORIOS por corrida y ninguna otra suite cuenta filas globales de
  // certificates. Lo que sí se limpia es lo que la BD permite.
  try {
    for (const id of seeded.enrollments) await svc.from("enrollments").delete().eq("id", id);
  } finally {
    // `companies`/`company_members` no tienen DELETE a propósito (5.2).
  }
});

/** Filas del listado, indexadas por certificado. */
async function rowsOf(filter: Parameters<typeof listExpirations>[1] = {}) {
  const report = await listExpirations(admin, filter, NOW);
  expect(report).not.toBeNull();
  return report!;
}
const keyOf = (certificateId: string): string | undefined =>
  Object.entries(certIds).find(([, id]) => id === certificateId)?.[0];
const keys = (rows: readonly { certificateId: string }[]): string[] =>
  rows.map((r) => keyOf(r.certificateId)).filter((k): k is string => k !== undefined);

describe("listado de vencimientos (admin)", () => {
  it("★ trae solo certificados CON vigencia, ordenados por urgencia, con la empresa", async () => {
    const report = await rowsOf();
    const mine = report.rows.filter((r) => keyOf(r.certificateId));

    // El certificado sin `expires_at` no está: no vence, no se recertifica.
    expect(keys(mine), "un certificado sin vigencia no pertenece al listado").not.toContain("sin_vigencia");
    // Orden por urgencia: primero lo vencido, luego lo más próximo.
    expect(keys(mine)).toEqual(["uno_vencido", "particular_10", "uno_evil", "dos_45", "uno_60"]);

    const uno60 = mine.find((r) => keyOf(r.certificateId) === "uno_60")!;
    expect(uno60.razonSocial).toBe("Constructora Demo Uno SpA");
    expect(uno60.daysLeft).toBe(60);
    expect(uno60.courseName).toBe("Manejo de sustancias peligrosas");
    // ★ El RUN va enmascarado incluso para el staff (minimización).
    expect(uno60.runMasked).toBe("51.XXX.XXX-X");
    expect(JSON.stringify(report.rows)).not.toContain("5126663-3");

    // El particular se distingue de una empresa (no se inventa razón social).
    const part = mine.find((r) => keyOf(r.certificateId) === "particular_10")!;
    expect(part.companyId).toBeNull();
    expect(part.razonSocial).toBeNull();

    // Lo ya vencido llega con daysLeft NEGATIVO (la UI lo marca "VENCIDO").
    expect(mine.find((r) => keyOf(r.certificateId) === "uno_vencido")!.daysLeft).toBe(-12);
  });

  it("★ filtro por companyId ⇒ SOLO los de esa empresa (la CA es 'por empresa')", async () => {
    const report = await rowsOf({ companyId: CO_UNO });
    const mine = report.rows.filter((r) => keyOf(r.certificateId));
    expect(new Set(keys(mine))).toEqual(new Set(["uno_60", "uno_evil", "uno_vencido"]));
    // Ni el de la otra empresa ni el particular.
    expect(keys(mine)).not.toContain("dos_45");
    expect(keys(mine)).not.toContain("particular_10");
    expect(mine.every((r) => r.companyId === CO_UNO)).toBe(true);
  });

  it("filtro 'none' ⇒ solo alumnos particulares (sin empresa que los mande)", async () => {
    const report = await rowsOf({ companyId: "none" });
    const mine = report.rows.filter((r) => keyOf(r.certificateId));
    expect(keys(mine)).toEqual(["particular_10"]);
  });

  it("★ la ventana acota hacia el futuro, pero NUNCA esconde lo ya vencido", async () => {
    const report = await rowsOf({ windowDays: 30 });
    const mine = report.rows.filter((r) => keyOf(r.certificateId));
    // 60 y 45 días quedan fuera; 20 y 10 entran; y el vencido SIGUE (es lo más urgente).
    expect(new Set(keys(mine))).toEqual(new Set(["uno_vencido", "particular_10", "uno_evil"]));
  });

  it("★ enlace de re-inscripción: apunta a OTRA acción del mismo curso, no a la que certificó", async () => {
    const report = await rowsOf({ companyId: CO_UNO });
    const row = report.rows.find((r) => keyOf(r.certificateId) === "uno_60")!;
    expect(row.actionId).toBe(ACTION_OLD);
    expect(row.recertifyActionId, "debe llevar a la acción NUEVA del curso").toBe(ACTION_NEW);
  });

  it("un curso sin otra acción ⇒ recertifyActionId null (la UI manda a crearla)", async () => {
    const courseSolo = randomUUID();
    const actionSolo = randomUUID();
    unwrap("curso solo", (await svc.from("courses").insert({
      id: courseSolo, tenant_id: TENANT_A, name: "Curso sin re-ejecución", sence: false, hours: 4, validity_months: 6,
    })).error);
    unwrap("acción sola", (await svc.from("actions").insert({
      id: actionSolo, tenant_id: TENANT_A, course_id: courseSolo, codigo_accion: `REP-SOLO-${randomUUID().slice(0, 5)}`,
      training_line: 3, environment: "rcetest",
    })).error);
    const userId = await freshUser();
    const enrollmentId = randomUUID();
    unwrap("inscripción sola", (await svc.from("enrollments").insert({
      id: enrollmentId, tenant_id: TENANT_A, action_id: actionSolo, user_id: userId,
      run: "8888888-8", first_names: "Solo", last_names: "Único",
    })).error);
    seeded.enrollments.push(enrollmentId);
    const certId = randomUUID();
    certIds["solo"] = certId;
    unwrap("cert solo", (await svc.from("certificates").insert({
      id: certId, tenant_id: TENANT_A, enrollment_id: enrollmentId, action_id: actionSolo, course_id: courseSolo,
      folio: `CERT-SOLO-${randomUUID().slice(0, 8)}`, verification_token: randomUUID().replace(/-/g, ""),
      snapshot: { studentName: "Único, Solo" }, expires_at: new Date(NOW + 30 * DAY_MS).toISOString(),
    })).error);

    const report = await rowsOf();
    const row = report.rows.find((r) => r.certificateId === certId)!;
    expect(row.recertifyActionId).toBeNull();
  });

  it("★ el listado NO es para el alumno (autorización del servicio)", async () => {
    expect(await listExpirations(student, {}, NOW)).toBeNull();
    expect(await buildExpirationsXlsx(student, {}, LABELS, NOW)).toBeNull();
  });

  it("consultar el listado deja rastro en audit_log (P8)", async () => {
    await rowsOf({ companyId: CO_DOS });
    const { data } = await svc.from("audit_log").select("id").eq("action", "certificates.expiry_report_viewed").eq("tenant_id", TENANT_A);
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  });
});

describe("export XLSX de vencimientos", () => {
  async function cellsOf(filter: Parameters<typeof buildExpirationsXlsx>[1]): Promise<string[]> {
    const out = await buildExpirationsXlsx(admin, filter, LABELS, NOW);
    expect(out).not.toBeNull();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out!.buffer as unknown as ArrayBuffer);
    const cells: string[] = [];
    wb.worksheets[0]!.eachRow((row) => row.eachCell((cell) => cells.push(String(cell.value))));
    return cells;
  }

  it("★ la celda hostil sale saneada (D-021: Excel no la evalúa como fórmula)", async () => {
    const cells = await cellsOf({ companyId: CO_UNO });
    const evil = cells.find((c) => c.includes("cmd|"));
    expect(evil, "la fila del nombre hostil debe estar en el Excel").toBeDefined();
    expect(evil!.startsWith("'"), `la celda debe empezar con ' y empieza con: ${evil}`).toBe(true);
    expect(cells, "el valor crudo no debe quedar en ninguna celda").not.toContain(`${EVIL_NAME}, Nicolás`);
  });

  it("★ el filtro por empresa manda también en el Excel, y no lleva RUN completo", async () => {
    const cells = await cellsOf({ companyId: CO_UNO });
    const joined = cells.join("|");
    expect(joined).toContain("Constructora Demo Uno SpA");
    // Nadie de la otra empresa ni el particular.
    expect(joined, "el Excel filtrado no debe traer a la otra empresa").not.toContain("Minera Demo Dos Ltda");
    expect(joined).not.toContain("Muñoz Díaz");
    expect(joined).not.toContain("Vera Soto");
    // RUN enmascarado (nunca el completo).
    expect(joined).toContain("51.XXX.XXX-X");
    for (const run of ["5126663-3", "16032460-0", "9876543-3"]) expect(joined).not.toContain(run);
  });

  it("lo vencido se rotula en es-CL y el particular no queda en blanco", async () => {
    const cells = await cellsOf({});
    expect(cells, "un día negativo no se muestra crudo").toContain("VENCIDO");
    expect(cells).toContain("Particular");
    // Encabezados en es-CL.
    expect(cells).toContain("TRABAJADOR(A)");
    expect(cells).toContain("VENCE EL");
  });

  it("descargar el Excel deja rastro en audit_log (P8)", async () => {
    await cellsOf({});
    const { data } = await svc.from("audit_log").select("id").eq("action", "certificates.expiry_report_downloaded").eq("tenant_id", TENANT_A);
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  });
});

describe("vencimientos en el portal de la empresa (HU-8.1 + HU-7.3)", () => {
  it("★ RRHH ve a SUS trabajadores por vencer y JAMÁS a los de otra empresa", async () => {
    const rows = await listCompanyExpirations(rrhh);
    const mine = rows.filter((r) => keyOf(r.certificateId));
    expect(new Set(keys(mine))).toEqual(new Set(["uno_60", "uno_evil", "uno_vencido"]));
    // La CA literal de HU-8.1: "jamás ve alumnos de otras empresas".
    expect(keys(mine)).not.toContain("dos_45");
    expect(keys(mine)).not.toContain("particular_10");
    // Ni el certificado sin vigencia (no hay nada que recertificar).
    expect(keys(mine)).not.toContain("sin_vigencia");

    // RUN SIEMPRE enmascarado en el portal.
    const json = JSON.stringify(rows);
    for (const run of ["5126663-3", "16032460-0", "11222333-4"]) expect(json).not.toContain(run);
    expect(rows[0]!.runMasked).toMatch(/^\d{1,2}\.XXX\.XXX-X$/);
  });

  it("★ el staff del OTEC NO entra por el portal de la empresa (gate del rol company)", async () => {
    expect(await listCompanyExpirations(admin)).toEqual([]);
    expect(await listCompanyExpirations(student)).toEqual([]);
  });

  it("cada consulta de la empresa queda auditada (RLS no escribe en SELECT)", async () => {
    await listCompanyExpirations(rrhh);
    const { data } = await svc.from("audit_log").select("id").eq("action", "company.expiries_viewed").eq("entity_id", CO_UNO);
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
