import "server-only";

import { writeAudit } from "@/lib/audit";
import { tenantGuard, type TenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { maskRun } from "@/modules/certificados/domain/folio";
import { daysUntil } from "@/modules/certificados/domain/expiry";
import { sortByUrgency, type ExpirationRowBase } from "@/modules/certificados/domain/expiry-report";
import { gradebookUnchecked } from "@/modules/evaluacion/gradebook-service";
import {
  companyExportRowValues,
  companyPanelRows,
  COMPANY_EXPORT_HEADERS,
  sanitizeXlsxCell,
  type CompanyCertLabels,
  type CompanyPanelRow,
} from "@/modules/portal-empresa/domain/company";
import { buildXlsx } from "@/modules/reportes/xlsx";

/**
 * Portal de la EMPRESA CLIENTE GATED (task 5.2, HU-8.1) — ESPEJO de
 * `supervisor-portal-service`. ÚNICA puerta de RRHH a los datos de SUS
 * trabajadores, y esto es literal: la migración 20260717030000 dejó al rol
 * `company` SIN rama en `enrollments_select` / `sence_sessions_select_staff`
 * (ni en `grades_select` / `certificates_select`), así que por PostgREST ve 0
 * filas. Todo dato de trabajador pasa por aquí o no pasa.
 *
 * Como el service-role SALTA RLS, aquí se re-verifica en código la membresía
 * ACTIVA y se acota TODA consulta a `company_id = mi empresa`, y CADA
 * consulta/descarga queda en `audit_log` (RLS no escribe en SELECT).
 *
 * Las páginas /empresa/* usan SOLO este servicio — nunca `cumplimiento-service`
 * ni `gradebook-service` directo (eso saltaría el gate y expondría a los
 * trabajadores de las OTRAS empresas del mismo OTEC: la CA de HU-8.1 dice
 * literalmente "jamás ve alumnos de otras empresas").
 *
 * El RUN va SIEMPRE enmascarado (dominio `company.ts`): RRHH hace seguimiento
 * con el nombre; el RUN completo no le hace falta (minimización, Ley 21.719).
 */

const PAGE = 1000;
/** Tope de ids por `.in()`: listas grandes revientan el URI de PostgREST. */
const IN_CHUNK = 100;

export interface CompanyIdentity {
  readonly companyId: string;
  readonly razonSocial: string;
}

export interface CompanyActionSummary {
  readonly actionId: string;
  readonly courseName: string;
  readonly codigoAccion: string;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  /** Trabajadores de MI empresa en esta acción (nunca el total de la acción). */
  readonly workers: number;
}

export interface CompanyActionPanel {
  readonly actionId: string;
  readonly courseName: string;
  readonly codigoAccion: string;
  readonly razonSocial: string;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly rows: readonly CompanyPanelRow[];
}

export interface CompanyExport {
  readonly filename: string;
  readonly buffer: Buffer;
}

/** Solo el rol `company` pasa por este servicio (el staff usa /admin directo). */
function gate(principal: Principal): boolean {
  return Boolean(principal.tenantId) && authorize(principal, principal.tenantId!, ["company"]);
}

/**
 * Empresa ACTIVA del caller. Sin membresía vigente → null (= forbidden).
 * `maybeSingle` es seguro: `company_members_active_uk` garantiza ≤1 fila activa
 * por (tenant, usuario) — por eso "mi empresa" está bien definido y no depende
 * de un `limit 1` arbitrario.
 */
async function activeCompany(guard: TenantGuard, userId: string): Promise<CompanyIdentity | null> {
  const { data: member } = await guard.db
    .from("company_members")
    .select("company_id")
    .eq("tenant_id", guard.tenantId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();
  if (!member) return null;

  const { data: company } = await guard.db
    .from("companies")
    .select("id, razon_social")
    .eq("tenant_id", guard.tenantId)
    .eq("id", member.company_id as string)
    .maybeSingle();
  if (!company) return null;
  return { companyId: company.id as string, razonSocial: company.razon_social as string };
}

async function fetchAll<T>(page: (offset: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await page(offset);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** `.in()` por lotes, cada lote paginado (un lote puede pasar de 1000 filas). */
async function fetchChunked<T>(
  ids: readonly string[],
  page: (chunk: string[], offset: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    for (let offset = 0; ; offset += PAGE) {
      const { data } = await page(chunk, offset);
      const rows = data ?? [];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

/**
 * Identidad de la empresa del caller (para el encabezado del portal).
 *
 * NO audita a propósito: no devuelve dato alguno de trabajadores, solo el nombre
 * de la empresa a la que el propio caller ya pertenece. Lo que se audita es el
 * ACCESO A DATOS (`listCompanyActions` / `getCompanyActionPanel` / export).
 */
export async function getMyCompany(principal: Principal): Promise<CompanyIdentity | null> {
  if (!gate(principal)) return null;
  const guard = tenantGuard(principal.tenantId!);
  return activeCompany(guard, principal.userId);
}

/** Acciones donde MI empresa tiene trabajadores. Audita `company.actions_viewed`. */
export async function listCompanyActions(principal: Principal): Promise<CompanyActionSummary[]> {
  if (!gate(principal)) return [];
  const tenantId = principal.tenantId!;
  const guard = tenantGuard(tenantId);
  const mine = await activeCompany(guard, principal.userId);
  if (!mine) return [];

  // El filtro por `company_id` es lo que hace que una acción de otra empresa ni
  // siquiera aparezca en el índice.
  const enrollments = await fetchAll<{ action_id: string }>((offset) =>
    guard.db
      .from("enrollments")
      .select("id, action_id")
      .eq("tenant_id", tenantId)
      .eq("company_id", mine.companyId)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1),
  );

  const workersByAction = new Map<string, number>();
  for (const e of enrollments) {
    workersByAction.set(e.action_id, (workersByAction.get(e.action_id) ?? 0) + 1);
  }
  const actionIds = [...workersByAction.keys()];

  let summaries: CompanyActionSummary[] = [];
  if (actionIds.length > 0) {
    const actions = await fetchChunked<{
      id: string;
      codigo_accion: string;
      starts_on: string | null;
      ends_on: string | null;
      courses: { name: string } | { name: string }[] | null;
    }>(actionIds, (chunk, offset) =>
      guard.db
        .from("actions")
        .select("id, codigo_accion, starts_on, ends_on, courses!inner(name)")
        .eq("tenant_id", tenantId)
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
    );
    summaries = actions
      .map((a) => {
        const rel = Array.isArray(a.courses) ? a.courses[0] : a.courses;
        return {
          actionId: a.id,
          courseName: rel?.name ?? "—",
          codigoAccion: a.codigo_accion,
          startsOn: a.starts_on,
          endsOn: a.ends_on,
          workers: workersByAction.get(a.id) ?? 0,
        };
      })
      .sort((a, b) => (b.startsOn ?? "").localeCompare(a.startsOn ?? ""));
  }

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "company.actions_viewed",
    entity: "companies",
    entityId: mine.companyId,
    details: { count: summaries.length },
  });
  return summaries;
}

/**
 * Arma el panel SIN auditar (cada llamador público audita SU acción: ver el
 * panel y descargarlo son hechos distintos en la bitácora).
 *
 * Devuelve null si la acción no es del tenant o si MI empresa no tiene ningún
 * trabajador en ella. Ese segundo caso es deliberado: si devolviera un panel
 * vacío, RRHH podría sondear cualquier `actionId` y deducir que existe y de qué
 * curso es (oráculo de enumeración). Deny-by-default, como el resto del portal.
 */
async function buildPanel(
  principal: Principal,
  guard: TenantGuard,
  mine: CompanyIdentity,
  actionId: string,
): Promise<CompanyActionPanel | null> {
  const tenantId = guard.tenantId;

  const { data: action } = await guard.db
    .from("actions")
    .select("id, course_id, codigo_accion, starts_on, ends_on, courses!inner(name)")
    .eq("tenant_id", tenantId)
    .eq("id", actionId)
    .maybeSingle();
  if (!action) return null;
  const courseRel = (action as { courses: { name: string } | { name: string }[] | null }).courses;
  const courseName = (Array.isArray(courseRel) ? courseRel[0]?.name : courseRel?.name) ?? "—";

  // ⚠ INVARIANTE del portal: esta consulta JAMÁS va sin `.eq("company_id", …)`.
  // Es el filtro que implementa "jamás ve alumnos de otras empresas".
  const enrollments = await fetchAll<{
    id: string;
    first_names: string | null;
    last_names: string | null;
    run: string;
    exento: boolean;
  }>((offset) =>
    guard.db
      .from("enrollments")
      .select("id, first_names, last_names, run, exento")
      .eq("tenant_id", tenantId)
      .eq("action_id", actionId)
      .eq("company_id", mine.companyId)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1),
  );
  if (enrollments.length === 0) return null;

  const enrollmentIds = enrollments.map((e) => e.id);
  const mineSet = new Set(enrollmentIds);

  const [lessons, progress, sessions, certificates, book] = await Promise.all([
    // Denominador del avance: lecciones PUBLICADAS del curso.
    fetchAll<{ id: string }>((offset) =>
      guard.db
        .from("lessons")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("course_id", action.course_id as string)
        .eq("status", "published")
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
    ),
    // Trae `lesson_id` porque el numerador se filtra DESPUÉS contra las lecciones
    // publicadas: el progreso de una lección despublicada sobrevive en la tabla.
    fetchChunked<{ enrollment_id: string; lesson_id: string }>(enrollmentIds, (chunk, offset) =>
      guard.db
        .from("lesson_progress")
        .select("enrollment_id, lesson_id, id")
        .eq("tenant_id", tenantId)
        .eq("completed", true)
        .in("enrollment_id", chunk)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
    ),
    fetchChunked<{ enrollment_id: string; status: string; opened_at: string | null; created_at: string }>(
      enrollmentIds,
      (chunk, offset) =>
        guard.db
          .from("sence_sessions")
          .select("enrollment_id, status, opened_at, created_at, id")
          .eq("tenant_id", tenantId)
          .in("enrollment_id", chunk)
          .order("id", { ascending: true })
          .range(offset, offset + PAGE - 1),
    ),
    fetchChunked<{ enrollment_id: string; folio: string; status: string }>(enrollmentIds, (chunk, offset) =>
      guard.db
        .from("certificates")
        // Sin `snapshot`: ese jsonb lleva el RUN COMPLETO (precedente D-030) y
        // aquí solo se necesitan folio y estado.
        .select("enrollment_id, folio, status, issued_at, id")
        .eq("tenant_id", tenantId)
        .in("enrollment_id", chunk)
        // `issued_at` no es único y el dominio hace "el primero gana": sin el
        // desempate por `id` el orden no es total, y Postgres no lo garantiza
        // estable entre las páginas de `.range()` ni entre ejecuciones.
        .order("issued_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
    ),
    // Libro OFICIAL de la acción (misma nota que ve el coordinador). Trae todas
    // las inscripciones de la acción: se descartan las ajenas de inmediato, más
    // abajo, y ninguna sale de este servicio.
    gradebookUnchecked(principal, actionId),
  ]);

  const grades = new Map<string, number>();
  for (const row of book?.gradebook.rows ?? []) {
    if (!mineSet.has(row.enrollmentId)) continue; // ← nada de otras empresas
    if (row.finalGrade !== null) grades.set(row.enrollmentId, row.finalGrade);
  }

  // Numerador y denominador sobre el MISMO conjunto: si el OTEC despublica una
  // lección, el `lesson_progress` de quien ya la completó sigue ahí, y contarlo
  // contra un denominador que ya la excluye daba 100 % a quien no completó ninguna
  // lección vigente.
  const publishedLessons = new Set(lessons.map((l) => l.id));

  const rows = companyPanelRows({
    enrollments: enrollments.map((e) => ({
      enrollmentId: e.id,
      firstNames: e.first_names,
      lastNames: e.last_names,
      run: e.run,
      exento: e.exento,
    })),
    totalLessons: lessons.length,
    completedLessons: progress
      .filter((p) => publishedLessons.has(p.lesson_id))
      .map((p) => ({ enrollmentId: p.enrollment_id })),
    sessions: sessions.map((s) => ({
      enrollmentId: s.enrollment_id,
      status: s.status,
      atMs: Date.parse(s.opened_at ?? s.created_at),
    })),
    grades,
    certificates: certificates.map((c) => ({
      enrollmentId: c.enrollment_id,
      folio: c.folio,
      status: c.status,
    })),
  });

  return {
    actionId,
    courseName,
    codigoAccion: action.codigo_accion as string,
    razonSocial: mine.razonSocial,
    startsOn: (action.starts_on as string | null) ?? null,
    endsOn: (action.ends_on as string | null) ?? null,
    rows,
  };
}

/** Panel de MIS trabajadores en una acción. Audita `company.panel_viewed`. */
export async function getCompanyActionPanel(
  principal: Principal,
  actionId: string,
): Promise<CompanyActionPanel | null> {
  if (!gate(principal)) return null;
  const guard = tenantGuard(principal.tenantId!);
  const mine = await activeCompany(guard, principal.userId);
  if (!mine) return null;

  const panel = await buildPanel(principal, guard, mine, actionId);
  if (!panel) return null;

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "company.panel_viewed",
    entity: "actions",
    entityId: actionId,
    details: { companyId: mine.companyId, workers: panel.rows.length },
  });
  return panel;
}

/**
 * Certificados de MIS trabajadores por vencer (task 5.12, HU-7.3). La CA dice
 * que el sistema alerta "a la OTEC y a la EMPRESA": esta es la mitad de la
 * empresa, y por eso vive AQUÍ y no en `expiry-report-service` — para heredar el
 * gate del rol `company`, el filtro por empresa y la auditoría de este portal.
 *
 * Mismo invariante que el resto del archivo: RUN enmascarado y TODA consulta de
 * inscripciones acotada a `company_id = mi empresa`. Incluye los ya vencidos
 * (daysLeft < 0): es justo lo que RRHH necesita accionar primero.
 */
export async function listCompanyExpirations(principal: Principal): Promise<ExpirationRowBase[]> {
  if (!gate(principal)) return [];
  const tenantId = principal.tenantId!;
  const guard = tenantGuard(tenantId);
  const mine = await activeCompany(guard, principal.userId);
  if (!mine) return [];

  // ⚠ INVARIANTE del portal: `.eq("company_id", …)` — sin esto, RRHH vería los
  // vencimientos de los trabajadores de las OTRAS empresas del mismo OTEC.
  const enrollments = await fetchAll<{ id: string; first_names: string | null; last_names: string | null; run: string }>(
    (offset) =>
      guard.db
        .from("enrollments")
        .select("id, first_names, last_names, run")
        .eq("tenant_id", tenantId)
        .eq("company_id", mine.companyId)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
  );
  if (enrollments.length === 0) {
    // Igual que el early-return de `certs.length === 0`: TODA consulta del portal
    // queda en la bitácora, incluso "empresa sin trabajadores" (invariante de la
    // cabecera de este archivo, gate de la task 5.2). Sin esto, RRHH podía sondear
    // /empresa repetidamente sin dejar rastro.
    await writeAudit(guard, {
      actorUserId: principal.userId,
      action: "company.expiries_viewed",
      entity: "companies",
      entityId: mine.companyId,
      details: { count: 0 },
    });
    return [];
  }
  const enrollmentById = new Map(enrollments.map((e) => [e.id, e]));

  const certs = await fetchChunked<{
    id: string; folio: string; enrollment_id: string; action_id: string; course_id: string; expires_at: string;
  }>(enrollments.map((e) => e.id), (chunk, offset) =>
    guard.db
      .from("certificates")
      // Sin `snapshot` (lleva el RUN completo, D-030).
      .select("id, folio, enrollment_id, action_id, course_id, expires_at")
      .eq("tenant_id", tenantId)
      .eq("status", "issued")
      .not("expires_at", "is", null)
      .in("enrollment_id", chunk)
      .order("expires_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1),
  );
  if (certs.length === 0) {
    await writeAudit(guard, {
      actorUserId: principal.userId,
      action: "company.expiries_viewed",
      entity: "companies",
      entityId: mine.companyId,
      details: { count: 0 },
    });
    return [];
  }

  const [courses, actions] = await Promise.all([
    fetchChunked<{ id: string; name: string }>([...new Set(certs.map((c) => c.course_id))], (chunk, offset) =>
      guard.db.from("courses").select("id, name").eq("tenant_id", tenantId).in("id", chunk).order("id").range(offset, offset + PAGE - 1),
    ),
    fetchChunked<{ id: string; codigo_accion: string }>([...new Set(certs.map((c) => c.action_id))], (chunk, offset) =>
      guard.db.from("actions").select("id, codigo_accion").eq("tenant_id", tenantId).in("id", chunk).order("id").range(offset, offset + PAGE - 1),
    ),
  ]);
  const courseName = new Map(courses.map((c) => [c.id, c.name]));
  const actionCode = new Map(actions.map((a) => [a.id, a.codigo_accion]));

  const now = Date.now();
  const rows: ExpirationRowBase[] = [];
  for (const c of certs) {
    const enr = enrollmentById.get(c.enrollment_id);
    if (!enr) continue;
    const daysLeft = daysUntil(c.expires_at, now);
    if (daysLeft === null) continue;
    const first = (enr.first_names ?? "").trim();
    const last = (enr.last_names ?? "").trim();
    rows.push({
      certificateId: c.id,
      folio: c.folio,
      studentName: last ? (first ? `${last}, ${first}` : last) : first || "—",
      runMasked: maskRun(enr.run),
      courseName: courseName.get(c.course_id) ?? "—",
      codigoAccion: actionCode.get(c.action_id) ?? "—",
      expiresAt: c.expires_at,
      daysLeft,
    });
  }

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "company.expiries_viewed",
    entity: "companies",
    entityId: mine.companyId,
    details: { count: rows.length },
  });
  return sortByUrgency(rows);
}

/** Export XLSX de las MISMAS filas. Audita `company.report_downloaded`. */
export async function getCompanyExport(
  principal: Principal,
  actionId: string,
  labels: CompanyCertLabels,
): Promise<CompanyExport | null> {
  if (!gate(principal)) return null;
  const guard = tenantGuard(principal.tenantId!);
  const mine = await activeCompany(guard, principal.userId);
  if (!mine) return null;

  const panel = await buildPanel(principal, guard, mine, actionId);
  if (!panel) return null;

  // TODA celda de texto pasa por el saneado anti-fórmula (D-021): los nombres
  // vienen del roster importado, o sea de entrada de terceros.
  const headers = COMPANY_EXPORT_HEADERS.map(sanitizeXlsxCell);
  const values = panel.rows.map((r) => companyExportRowValues(r, labels).map(sanitizeXlsxCell));
  const buffer = await buildXlsx("Avance", headers, values);

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "company.report_downloaded",
    entity: "actions",
    entityId: actionId,
    details: { companyId: mine.companyId, workers: panel.rows.length },
  });
  return {
    filename: `avance_empresa-accion_${panel.codigoAccion.replace(/[^\w.-]/g, "_")}`,
    buffer,
  };
}
