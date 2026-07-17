/**
 * Integración del Portal de la EMPRESA CLIENTE (task 5.2, HU-8.1) contra
 * Supabase local: invitación de RRHH end-to-end, portal GATED (solo MIS
 * trabajadores + auditoría por consulta), export XLSX saneado, revocación que
 * corta el acceso y la guardia cruzada de `assignEnrollmentCompany`.
 * Requiere `supabase db reset`.
 *
 * NOTA DE FIXTURES (residuo consciente). Esta suite NO limpia: `grades`,
 * `lesson_progress`, `sence_sessions` y `certificates` NO tienen DELETE para el
 * service_role (son historia académica/SENCE, inmutable por diseño), y sus FK
 * `on delete restrict` impiden borrar las inscripciones que cuelgan de ellas —
 * y con eso, la acción y el curso. Por eso TODO id/correo/RUT va aleatorio por
 * corrida: el residuo es inerte y no colisiona (mismo criterio que
 * `supervisor-portal.integration.test.ts` y que `company.rls.test.ts`).
 *
 * Para que ese residuo no rompa a OTRAS suites, estos fixtures NO tocan:
 *  - las empresas del seed (`permission-matrix` fija en 1 lo que ve Los Aromos);
 *  - el alumno del seed (`company.rls.test.ts` fija su lista de inscripciones);
 *  - la acción demo (`company.rls.test.ts` cuenta sus 3 inscritos).
 * Los trabajadores de aquí son usuarios de Auth NUEVOS, en una acción NUEVA, de
 * empresas NUEVAS. Datos 100% ficticios (CLAUDE.md).
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { noopEmailSender } from "@/modules/comunicacion/email-sender";
import type { Principal } from "@/modules/core/domain/rbac";
import { computeDv } from "@/modules/sence/domain/run";
import {
  assignEnrollmentCompany,
  createCompany,
  inviteCompanyMember,
  listCompanies,
  revokeCompanyMember,
} from "@/modules/portal-empresa/company-service";
import {
  getCompanyActionPanel,
  getCompanyExport,
  getMyCompany,
  listCompanyActions,
} from "@/modules/portal-empresa/company-portal-service";
import { collectWeeklySummaryData } from "@/modules/portal-empresa/company-weekly-data";
import type { CompanyCertLabels } from "@/modules/portal-empresa/domain/company";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

/** Los rótulos que inyecta la ruta del export (esCL.companyPortal). */
const CERT_LABELS: CompanyCertLabels = { issued: "Vigente", revoked: "Revocado" };

const admin: Principal = {
  userId: "aaaaaaaa-0000-4000-8000-000000000001",
  tenantId: TENANT_A,
  roles: ["otec_admin"],
};

let svc: SupabaseClient;

function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

/**
 * Extrae el error de un resultado discriminado. Falla ruidosamente si la
 * operación resultó OK: así un `expect(...).toBe("forbidden")` nunca pasa por
 * accidente cuando el servicio dejó de rechazar lo que debía rechazar.
 */
function errorOf<E extends string>(result: { ok: true } | { ok: false; error: E }): E {
  if (result.ok) throw new Error("se esperaba un fallo, pero la operación resultó ok");
  return result.error;
}

/** RUT ficticio con DV real (createCompany valida el módulo 11). */
function randomRut(): string {
  const body = String(70_000_000 + Math.floor(Math.random() * 9_000_000));
  return `${body}-${computeDv(body)}`;
}

/** Usuario de Auth NUEVO (jamás un usuario del seed: ver nota de fixtures). */
async function freshWorker(): Promise<string> {
  const { data, error } = await svc.auth.admin.createUser({
    email: `worker-${randomUUID().slice(0, 8)}@trabajador.test`,
    email_confirm: true,
    password: `Wk-${randomUUID()}`,
  });
  if (error || !data.user) throw new Error(`no se pudo crear el trabajador: ${error?.message}`);
  return data.user.id;
}

interface Fixture {
  actionId: string;
  courseId: string;
  quizId: string;
  companyA: string;
  companyB: string;
  enrW1: string;
  enrW2: string;
  enrW3: string;
  /** Folio del certificado de W2, REVOCADO y sin reemitir. */
  revokedFolio: string;
}

/** Curso + 2 lecciones publicadas + quiz publicado + acción + 3 inscripciones. */
async function seedFixture(): Promise<Fixture> {
  const courseId = randomUUID();
  await svc.from("courses").insert({
    id: courseId,
    tenant_id: TENANT_A,
    name: "Curso 5.2 — portal empresa",
    sence: true,
    cod_sence: "1234567890",
  });

  // 2 lecciones publicadas = denominador del avance (1 completada → 50 %).
  const lessonIds = [randomUUID(), randomUUID()];
  await svc.from("lessons").insert(
    lessonIds.map((id, i) => ({
      id,
      tenant_id: TENANT_A,
      course_id: courseId,
      title: `Lección ${i + 1}`,
      kind: "text",
      content: "Contenido ficticio.",
      position: i + 1,
      status: "published",
    })),
  );

  // Lección DESPUBLICADA que W1 alcanzó a completar cuando estaba publicada. NO es
  // denominador ni numerador: el `lesson_progress` sobrevive a la despublicación, y
  // contarlo contra un denominador que ya la excluye daba 100 % (2/2) a quien va por
  // la mitad del curso vigente.
  const unpublishedLesson = randomUUID();
  await svc.from("lessons").insert({
    id: unpublishedLesson,
    tenant_id: TENANT_A,
    course_id: courseId,
    title: "Lección retirada del curso",
    kind: "text",
    content: "Contenido ficticio.",
    position: 3,
    status: "draft",
  });

  // Instrumento del libro OFICIAL: sin quiz publicado no hay nota consolidada.
  const quizId = randomUUID();
  await svc.from("quizzes").insert({
    id: quizId,
    tenant_id: TENANT_A,
    course_id: courseId,
    title: "Quiz 5.2",
    status: "published",
    passing_pct: 60,
    weight: 1,
  });

  const actionId = randomUUID();
  await svc.from("actions").insert({
    id: actionId,
    tenant_id: TENANT_A,
    course_id: courseId,
    codigo_accion: `EMP-${randomUUID().slice(0, 6)}`,
    training_line: 3,
    environment: "rcetest",
    starts_on: "2026-07-01",
    ends_on: "2026-12-31",
    status: "active",
  });

  const [w1, w2, w3] = [await freshWorker(), await freshWorker(), await freshWorker()];
  const [enrW1, enrW2, enrW3] = [randomUUID(), randomUUID(), randomUUID()];
  await svc.from("enrollments").insert([
    // Nace SIN empresa: la vinculación la hace el servicio (happy path del test).
    {
      id: enrW1,
      tenant_id: TENANT_A,
      action_id: actionId,
      user_id: w1,
      run: "20111222-3",
      first_names: "Valentina",
      last_names: "Rojas Miranda",
    },
    {
      id: enrW2,
      tenant_id: TENANT_A,
      action_id: actionId,
      user_id: w2,
      run: "20111333-4",
      // ⚠ Nombre HOSTIL a propósito (D-021): así viene un roster importado por un
      // tercero. Debe salir del XLSX con `'` delante, no como fórmula.
      first_names: null,
      last_names: "=SUM(A1)",
    },
    {
      id: enrW3,
      tenant_id: TENANT_A,
      action_id: actionId,
      user_id: w3,
      run: "20111444-5",
      first_names: "Ignacio",
      last_names: "Soto Vera",
    },
  ]);

  // Avance de W1: 1 de 2 lecciones PUBLICADAS → 50 % (la despublicada no suma).
  await svc.from("lesson_progress").insert([
    {
      tenant_id: TENANT_A,
      enrollment_id: enrW1,
      lesson_id: lessonIds[0]!,
      completed: true,
      completed_at: new Date().toISOString(),
    },
    {
      tenant_id: TENANT_A,
      enrollment_id: enrW1,
      lesson_id: unpublishedLesson,
      completed: true,
      completed_at: new Date().toISOString(),
    },
  ]);

  // Asistencia SENCE de W1: 2 sesiones cerradas el MISMO día → 1 día.
  await svc.from("sence_sessions").insert([
    {
      tenant_id: TENANT_A,
      enrollment_id: enrW1,
      sence_course_code: "1234567890",
      action_code: "EMP-TEST",
      training_line: 3,
      run_alumno: "20111222-3",
      id_sesion_alumno: `t52-${randomUUID().slice(0, 8)}`,
      id_sesion_sence: "525252",
      status: "cerrada",
      environment: "rcetest",
      opened_at: "2026-07-06T13:00:00Z",
      closed_at: "2026-07-06T14:00:00Z",
    },
    {
      tenant_id: TENANT_A,
      enrollment_id: enrW1,
      sence_course_code: "1234567890",
      action_code: "EMP-TEST",
      training_line: 3,
      run_alumno: "20111222-3",
      id_sesion_alumno: `t52-${randomUUID().slice(0, 8)}`,
      id_sesion_sence: "525253",
      status: "cerrada",
      environment: "rcetest",
      opened_at: "2026-07-06T18:00:00Z",
      closed_at: "2026-07-06T19:00:00Z",
    },
    // W2: el BORDE de día. Chile es UTC-4 en julio, así que esta sesión ocurre el
    // 5-jul 22:00 en Santiago pero el 6-jul en UTC. Con la siguiente son 2 días
    // distintos para Santiago y UNO SOLO si alguien bucketiza por la fecha UTC.
    {
      tenant_id: TENANT_A,
      enrollment_id: enrW2,
      sence_course_code: "1234567890",
      action_code: "EMP-TEST",
      training_line: 3,
      run_alumno: "20111333-4",
      id_sesion_alumno: `t52-${randomUUID().slice(0, 8)}`,
      id_sesion_sence: "525254",
      status: "cerrada",
      environment: "rcetest",
      opened_at: "2026-07-06T02:00:00Z", // 2026-07-05 22:00 Santiago
      closed_at: "2026-07-06T03:00:00Z", // 2026-07-05 23:00 Santiago
    },
    {
      tenant_id: TENANT_A,
      enrollment_id: enrW2,
      sence_course_code: "1234567890",
      action_code: "EMP-TEST",
      training_line: 3,
      run_alumno: "20111333-4",
      id_sesion_alumno: `t52-${randomUUID().slice(0, 8)}`,
      id_sesion_sence: "525255",
      status: "cerrada",
      environment: "rcetest",
      opened_at: "2026-07-06T13:00:00Z", // 2026-07-06 09:00 Santiago
      closed_at: "2026-07-06T14:00:00Z",
    },
  ]);

  // W1: nota PUBLICADA. W2: nota en BORRADOR (jamás debe llegar a la empresa).
  await svc.from("grades").insert([
    {
      tenant_id: TENANT_A,
      enrollment_id: enrW1,
      source_kind: "quiz",
      quiz_id: quizId,
      grade: 6.5,
      status: "published",
      published_at: new Date().toISOString(),
    },
    {
      tenant_id: TENANT_A,
      enrollment_id: enrW2,
      source_kind: "quiz",
      quiz_id: quizId,
      grade: 4.0,
      status: "draft",
    },
  ]);

  await svc.from("certificates").insert({
    tenant_id: TENANT_A,
    enrollment_id: enrW1,
    action_id: actionId,
    course_id: courseId,
    folio: `CERT-2026-${randomUUID().slice(0, 6)}`,
    verification_token: randomUUID(),
    status: "issued",
    snapshot: { nombre: "Valentina Rojas Miranda", runMasked: "20.XXX.XXX-X" },
  });

  // W2: certificado REVOCADO y NO reemitido. Revocar es un UPDATE: la fila y el
  // folio sobreviven, así que el panel puede pintar un folio que ya no vale. Es el
  // caso que el fixture original no tenía y por eso nadie cazaba.
  const revokedFolio = `CERT-2026-${randomUUID().slice(0, 6)}`;
  await svc.from("certificates").insert({
    tenant_id: TENANT_A,
    enrollment_id: enrW2,
    action_id: actionId,
    course_id: courseId,
    folio: revokedFolio,
    verification_token: randomUUID(),
    status: "revoked",
    revoked_reason: "Error en el folio (fixture)",
    revoked_at: new Date().toISOString(),
    snapshot: { nombre: "Sin nombre", runMasked: "20.XXX.XXX-X" },
  });

  const a = await createCompany(admin, { rut: randomRut(), razonSocial: `Empresa A ${randomUUID().slice(0, 4)}` });
  const b = await createCompany(admin, { rut: randomRut(), razonSocial: `Empresa B ${randomUUID().slice(0, 4)}` });
  if (!a.ok || !b.ok) throw new Error("no se pudieron crear las empresas del fixture");

  return {
    actionId,
    courseId,
    quizId,
    companyA: a.companyId,
    companyB: b.companyId,
    enrW1,
    enrW2,
    enrW3,
    revokedFolio,
  };
}

let fx: Fixture;

beforeAll(async () => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
  fx = await seedFixture();
}, 60_000);

describe("company-service — alta, vinculación y guardia cruzada", () => {
  it("crea la empresa, la lista y audita el alta", async () => {
    const companies = await listCompanies(admin);
    const mine = companies?.find((c) => c.id === fx.companyA);
    expect(mine).toBeDefined();
    expect(
      (await svc.from("audit_log").select("id").eq("action", "company.created").eq("entity_id", fx.companyA)).data
        ?.length ?? 0,
    ).toBeGreaterThanOrEqual(1);
  });

  it("rechaza el RUT con DV inválido y el RUT duplicado en el mismo OTEC", async () => {
    expect(errorOf(await createCompany(admin, { rut: "77123456-8", razonSocial: "DV malo" }))).toBe("invalid");
    const rut = randomRut();
    expect((await createCompany(admin, { rut, razonSocial: "Primera" })).ok).toBe(true);
    expect(errorOf(await createCompany(admin, { rut, razonSocial: "Repetida" }))).toBe("duplicate");
  });

  it("un alumno no puede crear empresas ni vincular inscripciones", async () => {
    const student: Principal = { userId: randomUUID(), tenantId: TENANT_A, roles: ["student"] };
    expect(errorOf(await createCompany(student, { rut: randomRut(), razonSocial: "Pirata" }))).toBe("forbidden");
    expect(errorOf(await assignEnrollmentCompany(student, fx.enrW1, fx.companyA))).toBe("forbidden");
  });

  it("vincula cada trabajador a su empresa y audita", async () => {
    expect((await assignEnrollmentCompany(admin, fx.enrW1, fx.companyA)).ok).toBe(true);
    expect((await assignEnrollmentCompany(admin, fx.enrW2, fx.companyA)).ok).toBe(true);
    expect((await assignEnrollmentCompany(admin, fx.enrW3, fx.companyB)).ok).toBe(true);
    expect(
      (await svc.from("audit_log").select("id").eq("action", "enrollment.company_assigned").eq("entity_id", fx.enrW1))
        .data?.length ?? 0,
    ).toBeGreaterThanOrEqual(1);
  });

  it("GUARDIA: una empresa de OTRO tenant no puede etiquetar una inscripción propia", async () => {
    // Empresa real, pero del tenant B: el service-role saltaría RLS sin la guardia.
    const foreign = randomUUID();
    await svc
      .from("companies")
      .insert({ id: foreign, tenant_id: TENANT_B, rut: randomRut(), razon_social: "Ajena SpA" });

    expect(errorOf(await assignEnrollmentCompany(admin, fx.enrW1, foreign))).toBe("company_not_found");

    // Y la vinculación previa quedó intacta (no se pisó con la ajena).
    const { data } = await svc.from("enrollments").select("company_id").eq("id", fx.enrW1).single();
    expect(data?.company_id).toBe(fx.companyA);
  });

  it("GUARDIA: no se puede etiquetar una inscripción de OTRO tenant con una empresa propia", async () => {
    const courseB = randomUUID();
    const actionB = randomUUID();
    const workerB = await freshWorker();
    const enrB = randomUUID();
    await svc.from("courses").insert({ id: courseB, tenant_id: TENANT_B, name: "Curso B", sence: false });
    await svc.from("actions").insert({
      id: actionB,
      tenant_id: TENANT_B,
      course_id: courseB,
      codigo_accion: `B-${randomUUID().slice(0, 6)}`,
      training_line: 3,
      environment: "rcetest",
    });
    await svc
      .from("enrollments")
      .insert({ id: enrB, tenant_id: TENANT_B, action_id: actionB, user_id: workerB, run: "20999888-7" });

    expect(errorOf(await assignEnrollmentCompany(admin, enrB, fx.companyA))).toBe("enrollment_not_found");

    await svc.from("enrollments").delete().eq("id", enrB);
    await svc.from("actions").delete().eq("id", actionB);
    await svc.from("courses").delete().eq("id", courseB);
  });

  it("desvincular (null) devuelve al trabajador a particular y lo saca del portal", async () => {
    const solo = randomUUID();
    const worker = await freshWorker();
    await svc.from("enrollments").insert({
      id: solo,
      tenant_id: TENANT_A,
      action_id: fx.actionId,
      user_id: worker,
      run: "20777666-5",
      first_names: "Temporal",
      last_names: "Sin Empresa",
    });
    expect((await assignEnrollmentCompany(admin, solo, fx.companyA)).ok).toBe(true);
    expect((await assignEnrollmentCompany(admin, solo, null)).ok).toBe(true);
    const { data } = await svc.from("enrollments").select("company_id").eq("id", solo).single();
    expect(data?.company_id).toBeNull();
    await svc.from("enrollments").delete().eq("id", solo);
  });
});

describe("portal empresa — invitación, escopado, auditoría, export y revocación", () => {
  it("invita a RRHH, escopa el panel a SUS trabajadores, exporta saneado y la revocación corta", async () => {
    const email = `rrhh-${randomUUID().slice(0, 8)}@empresa.test`;

    // ---- Invitación end-to-end ----
    const invited = await inviteCompanyMember(
      admin,
      { companyId: fx.companyA, email },
      { emailSender: noopEmailSender() },
    );
    expect(invited.ok).toBe(true);
    if (!invited.ok) return;
    // Sin RESEND el flujo NO se bloquea: el enlace copiable es el degrade.
    expect(invited.inviteLink).toBeTruthy();
    expect(invited.emailSent).toBe(false);

    const { data: member } = await svc
      .from("company_members")
      .select("user_id, company_id")
      .eq("id", invited.memberId)
      .single();
    const rrhhUserId = member!.user_id as string;

    // El rol `company` quedó MERGEADO en la membresía (no pisó otros roles).
    const { data: membership } = await svc
      .from("memberships")
      .select("roles, status")
      .eq("tenant_id", TENANT_A)
      .eq("user_id", rrhhUserId)
      .single();
    expect(membership!.roles as string[]).toContain("company");

    expect(
      (await svc.from("audit_log").select("id").eq("action", "company.member_invited").eq("entity_id", invited.memberId))
        .data?.length ?? 0,
    ).toBeGreaterThanOrEqual(1);

    const rrhh: Principal = { userId: rrhhUserId, tenantId: TENANT_A, roles: ["company"] };

    // ---- Identidad + índice de acciones ----
    expect((await getMyCompany(rrhh))?.companyId).toBe(fx.companyA);
    const actions = await listCompanyActions(rrhh);
    const mineAction = actions.find((a) => a.actionId === fx.actionId);
    expect(mineAction).toBeDefined();
    // Cuenta SOLO a los suyos (2 de los 3 inscritos de la acción).
    expect(mineAction!.workers).toBe(2);
    expect(
      (await svc.from("audit_log").select("id").eq("action", "company.actions_viewed").eq("entity_id", fx.companyA))
        .data?.length ?? 0,
    ).toBeGreaterThanOrEqual(1);

    // ---- El panel: SOLO mis trabajadores (CA literal de HU-8.1) ----
    const panel = await getCompanyActionPanel(rrhh, fx.actionId);
    expect(panel).not.toBeNull();
    const ids = new Set(panel!.rows.map((r) => r.enrollmentId));
    expect(ids.has(fx.enrW1)).toBe(true);
    expect(ids.has(fx.enrW2)).toBe(true);
    expect(ids.has(fx.enrW3), "jamás ve al trabajador de la OTRA empresa").toBe(false);
    expect(panel!.rows).toHaveLength(2);

    const w1 = panel!.rows.find((r) => r.enrollmentId === fx.enrW1)!;
    const w2 = panel!.rows.find((r) => r.enrollmentId === fx.enrW2)!;
    // 1 de 2 lecciones PUBLICADAS. W1 también completó la lección despublicada: si
    // el numerador no la descartara, esto sería 100 % (2/2) y RRHH leería "terminó
    // el curso" de quien va por la mitad.
    expect(w1.progressPct).toBe(50);
    expect(w1.attendanceDays).toBe(1); // 2 sesiones cerradas el mismo día
    expect(w1.grade).toBe(6.5); // nota PUBLICADA
    expect(w1.certificateFolio).toBeTruthy();
    expect(w1.certificateStatus).toBe("issued");
    expect(w2.grade, "la nota en BORRADOR jamás llega a la empresa").toBeNull();

    // El certificado de W2 está REVOCADO y conserva su folio: la fila DEBE llevar
    // el estado, o la UI pinta un folio muerto como si estuviera vigente.
    expect(w2.certificateFolio).toBe(fx.revokedFolio);
    expect(w2.certificateStatus).toBe("revoked");

    // El RUN va SIEMPRE enmascarado: ningún RUN completo sale del servicio.
    expect(w1.runMasked).toBe("20.XXX.XXX-X");
    expect(JSON.stringify(panel)).not.toContain("20111222-3");
    expect(JSON.stringify(panel)).not.toContain("20111333-4");

    expect(
      (await svc.from("audit_log").select("id").eq("action", "company.panel_viewed").eq("entity_id", fx.actionId)).data
        ?.length ?? 0,
    ).toBeGreaterThanOrEqual(1);

    // ---- Export XLSX: parsea y viene saneado (D-021) ----
    const exported = await getCompanyExport(rrhh, fx.actionId, CERT_LABELS);
    expect(exported).not.toBeNull();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(exported!.buffer as unknown as ArrayBuffer);
    const cells: string[] = [];
    wb.worksheets[0]!.eachRow((row) => {
      row.eachCell((cell) => cells.push(String(cell.value)));
    });
    expect(cells, "la celda hostil sale con ' delante, no como fórmula").toContain("'=SUM(A1)");
    expect(cells).not.toContain("=SUM(A1)");
    // El export tampoco lleva RUN completo ni al trabajador ajeno.
    expect(cells).toContain("20.XXX.XXX-X");
    expect(cells.join("|")).not.toContain("20111222-3");
    expect(cells.some((c) => c.includes("Soto Vera")), "el ajeno no está en el Excel").toBe(false);
    // El estado va en es-CL (lo abre RRHH), no como el enum crudo de la BD.
    expect(cells, "el certificado revocado se declara como tal en el Excel").toContain("Revocado");
    expect(cells).toContain("Vigente");
    expect(cells).not.toContain("revoked");

    expect(
      (await svc.from("audit_log").select("id").eq("action", "company.report_downloaded").eq("entity_id", fx.actionId))
        .data?.length ?? 0,
    ).toBeGreaterThanOrEqual(1);

    // ---- Revocación: corta el acceso de inmediato ----
    expect((await revokeCompanyMember(admin, invited.memberId)).ok).toBe(true);
    expect(await listCompanyActions(rrhh)).toHaveLength(0);
    expect(await getCompanyActionPanel(rrhh, fx.actionId)).toBeNull();
    expect(await getCompanyExport(rrhh, fx.actionId, CERT_LABELS)).toBeNull();
    expect(await getMyCompany(rrhh)).toBeNull();
    expect(
      (await svc.from("audit_log").select("id").eq("action", "company.member_revoked").eq("entity_id", invited.memberId))
        .data?.length ?? 0,
    ).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("re-invitar a la MISMA persona en otra empresa revoca su membresía anterior", async () => {
    const email = `rrhh-${randomUUID().slice(0, 8)}@empresa.test`;
    const first = await inviteCompanyMember(
      admin,
      { companyId: fx.companyA, email },
      { emailSender: noopEmailSender() },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await inviteCompanyMember(
      admin,
      { companyId: fx.companyB, email },
      { emailSender: noopEmailSender() },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // La primera quedó revocada: `company_members_active_uk` exige una sola activa.
    const { data: before } = await svc.from("company_members").select("revoked_at").eq("id", first.memberId).single();
    expect(before?.revoked_at).not.toBeNull();

    // Y ahora ve la empresa NUEVA, no la anterior.
    const { data: m } = await svc.from("company_members").select("user_id").eq("id", second.memberId).single();
    const rrhh: Principal = { userId: m!.user_id as string, tenantId: TENANT_A, roles: ["company"] };
    expect((await getMyCompany(rrhh))?.companyId).toBe(fx.companyB);
  }, 60_000);

  it("un usuario `company` SIN membresía vigente no ve nada (el rol entra cerrado)", async () => {
    const orphan: Principal = { userId: await freshWorker(), tenantId: TENANT_A, roles: ["company"] };
    expect(await getMyCompany(orphan)).toBeNull();
    expect(await listCompanyActions(orphan)).toHaveLength(0);
    expect(await getCompanyActionPanel(orphan, fx.actionId)).toBeNull();
  });

  it("la empresa NO puede sondear una acción donde no tiene trabajadores", async () => {
    const email = `rrhh-${randomUUID().slice(0, 8)}@empresa.test`;
    const invited = await inviteCompanyMember(
      admin,
      { companyId: fx.companyB, email },
      { emailSender: noopEmailSender() },
    );
    expect(invited.ok).toBe(true);
    if (!invited.ok) return;
    const { data: m } = await svc.from("company_members").select("user_id").eq("id", invited.memberId).single();
    const rrhhB: Principal = { userId: m!.user_id as string, tenantId: TENANT_A, roles: ["company"] };

    // La acción demo del seed existe y es del tenant, pero B no tiene a nadie
    // ahí: null (no distingue "no existe" de "no es tuya" — sin oráculo).
    expect(await getCompanyActionPanel(rrhhB, "ac000000-0000-4000-8000-000000000001")).toBeNull();
    // En cambio SÍ ve la acción del fixture, donde tiene a su trabajador.
    const panelB = await getCompanyActionPanel(rrhhB, fx.actionId);
    expect(panelB!.rows).toHaveLength(1);
    expect(panelB!.rows[0]!.enrollmentId).toBe(fx.enrW3);
  }, 60_000);
});

describe("collectWeeklySummaryData — los agregados del digest (HU-8.2, punto de extensión de 5.9)", () => {
  it("cuenta los días de asistencia en hora de SANTIAGO y por `opened_at`, igual que el panel", async () => {
    // El borde que nadie cubría. W2 tiene 2 sesiones que caen el MISMO día en UTC
    // (ambas cierran el 6-jul UTC) pero en DÍAS DISTINTOS en Santiago (5 y 6 de
    // julio: Chile es UTC-4 en julio). Bucketizar por `closed_at.slice(0,10)` —el
    // ISO en UTC— las colapsaba en 1 y el correo semanal contradecía al panel que
    // esa misma RRHH está mirando, sobre asistencia SENCE (dato de valor legal).
    const data = await collectWeeklySummaryData(svc, TENANT_A, fx.companyA, "2026-07-01T00:00:00Z");
    expect(data).not.toBeNull();
    // W1: 2 sesiones el mismo día de Santiago → 1. W2: 5-jul + 6-jul → 2.
    expect(data!.attendanceDaysInPeriod, "W1 aporta 1 día y W2 aporta 2 (no 1)").toBe(3);
    expect(data!.workers).toBe(2); // W1 y W2; W3 es de la otra empresa
    expect(data!.actions).toBe(1);
  });

  it("no cuenta a los trabajadores de otra empresa ni devuelve dato personal", async () => {
    const data = await collectWeeklySummaryData(svc, TENANT_A, fx.companyB, "2026-07-01T00:00:00Z");
    expect(data!.workers).toBe(1); // solo W3
    // Contrato de privacidad (RNF-10): del helper SOLO salen conteos + razón social.
    const json = JSON.stringify(data);
    expect(json).not.toContain("20111444-5");
    expect(json).not.toContain("Soto Vera");
  });

  it("empresa inexistente en el tenant → null", async () => {
    expect(await collectWeeklySummaryData(svc, TENANT_B, fx.companyA, "2026-07-01T00:00:00Z")).toBeNull();
  });
});
