import "server-only";

import { writeAudit } from "@/lib/audit";
import { tenantGuard, type TenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { maskRun } from "@/modules/certificados/domain/folio";
import { daysUntil } from "@/modules/certificados/domain/expiry";
import {
  expirationExportRowValues,
  pickRecertifyAction,
  sortByUrgency,
  EXPIRATION_EXPORT_HEADERS,
  type ExpirationExportLabels,
  type ExpirationRow,
} from "@/modules/certificados/domain/expiry-report";
import { sanitizeXlsxCell } from "@/modules/portal-empresa/domain/company";
import { buildXlsx } from "@/modules/reportes/xlsx";

/**
 * Listado de vencimientos por empresa, exportable (task 5.12, HU-7.3).
 *
 * Es la vista de la OTEC: qué trabajadores pierden la certificación y cuándo,
 * filtrable por empresa y por ventana. Incluye los YA VENCIDOS (daysLeft < 0) —
 * al revés que el job de alertas, que no los notifica: el correo es un
 * recordatorio (y a un vencido ya no le sirve), pero el listado es la lista de
 * trabajo del coordinador, y ahí lo vencido es lo MÁS urgente.
 *
 * El RUN va enmascarado también para el staff: esta pantalla decide a quién
 * recertificar, y para eso el nombre basta (minimización, Ley 21.719). El RUN
 * completo sigue disponible donde el spec lo exige (roster, DJ, PDF).
 */

const VIEWERS = ["otec_admin", "coordinator"] as const;
const PAGE = 1000;
const IN_CHUNK = 100;

export interface ExpirationsFilter {
  /**
   * UUID de empresa; `"none"` = solo alumnos particulares (sin empresa que los
   * mande); null/undefined = todas. El sentinel no puede chocar con un id real
   * (los ids son UUID).
   */
  readonly companyId?: string | "none" | null;
  /** Solo los que vencen dentro de N días (los ya vencidos entran siempre). */
  readonly windowDays?: number | null;
}

export interface ExpirationsReport {
  readonly rows: readonly ExpirationRow[];
  readonly companies: readonly { readonly id: string; readonly razonSocial: string }[];
}

export interface ExpirationsExport {
  readonly filename: string;
  readonly buffer: Buffer;
}

function canView(p: Principal): boolean {
  return Boolean(p.tenantId) && authorize(p, p.tenantId!, VIEWERS);
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

interface CertRow {
  id: string;
  folio: string;
  enrollment_id: string;
  action_id: string;
  course_id: string;
  expires_at: string;
}

/**
 * Filas del listado. `guard` ya fija el tenant; TODA consulta lleva su
 * `.eq("tenant_id", …)` explícito porque el service-role bypassa RLS.
 */
async function buildRows(
  guard: TenantGuard,
  tenantId: string,
  filter: ExpirationsFilter,
  nowMs: number,
): Promise<ExpirationRow[]> {
  const certs = await fetchAll<CertRow>((offset) =>
    guard.db
      .from("certificates")
      // Sin `snapshot`: ese jsonb lleva el RUN COMPLETO (precedente D-030) y el
      // nombre se toma de `enrollments`, que es el dato vivo del roster.
      .select("id, folio, enrollment_id, action_id, course_id, expires_at")
      .eq("tenant_id", tenantId)
      .eq("status", "issued")
      .not("expires_at", "is", null)
      .order("expires_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1),
  );
  if (certs.length === 0) return [];

  const enrollmentIds = [...new Set(certs.map((c) => c.enrollment_id))];
  const [enrollments, actions, courses, companies] = await Promise.all([
    fetchChunked<{ id: string; first_names: string | null; last_names: string | null; run: string; company_id: string | null }>(
      enrollmentIds,
      (chunk, offset) =>
        guard.db
          .from("enrollments")
          .select("id, first_names, last_names, run, company_id")
          .eq("tenant_id", tenantId)
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(offset, offset + PAGE - 1),
    ),
    // TODAS las acciones del tenant: son el universo de candidatas para el
    // enlace de re-inscripción (y la fuente del código de la acción certificada).
    fetchAll<{ id: string; course_id: string; codigo_accion: string; starts_on: string | null; created_at: string }>((offset) =>
      guard.db
        .from("actions")
        .select("id, course_id, codigo_accion, starts_on, created_at")
        .eq("tenant_id", tenantId)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
    ),
    fetchAll<{ id: string; name: string }>((offset) =>
      guard.db.from("courses").select("id, name").eq("tenant_id", tenantId).order("id", { ascending: true }).range(offset, offset + PAGE - 1),
    ),
    fetchAll<{ id: string; razon_social: string }>((offset) =>
      guard.db.from("companies").select("id, razon_social").eq("tenant_id", tenantId).order("id", { ascending: true }).range(offset, offset + PAGE - 1),
    ),
  ]);

  const enrollmentById = new Map(enrollments.map((e) => [e.id, e]));
  const actionById = new Map(actions.map((a) => [a.id, a]));
  const courseName = new Map(courses.map((c) => [c.id, c.name]));
  const razonSocial = new Map(companies.map((c) => [c.id, c.razon_social]));
  const actionsByCourse = new Map<string, { id: string; startsOn: string | null; createdAt: string }[]>();
  for (const a of actions) {
    const list = actionsByCourse.get(a.course_id) ?? [];
    list.push({ id: a.id, startsOn: a.starts_on, createdAt: a.created_at });
    actionsByCourse.set(a.course_id, list);
  }

  const rows: ExpirationRow[] = [];
  for (const c of certs) {
    const enr = enrollmentById.get(c.enrollment_id);
    if (!enr) continue; // fila huérfana: no debería existir (FK restrict).
    const companyId = enr.company_id ?? null;
    if (filter.companyId === "none") {
      if (companyId !== null) continue;
    } else if (filter.companyId && companyId !== filter.companyId) {
      continue;
    }

    const daysLeft = daysUntil(c.expires_at, nowMs);
    if (daysLeft === null) continue;
    // La ventana acota SOLO hacia el futuro: un certificado ya vencido es lo más
    // urgente de la lista y jamás se esconde por elegir "próximos 30 días".
    if (filter.windowDays != null && daysLeft > filter.windowDays) continue;

    const first = (enr.first_names ?? "").trim();
    const last = (enr.last_names ?? "").trim();
    rows.push({
      certificateId: c.id,
      folio: c.folio,
      studentName: last ? (first ? `${last}, ${first}` : last) : first || "—",
      runMasked: maskRun(enr.run),
      courseId: c.course_id,
      courseName: courseName.get(c.course_id) ?? "—",
      actionId: c.action_id,
      codigoAccion: actionById.get(c.action_id)?.codigo_accion ?? "—",
      companyId,
      razonSocial: companyId ? (razonSocial.get(companyId) ?? null) : null,
      expiresAt: c.expires_at,
      daysLeft,
      recertifyActionId: pickRecertifyAction(c.action_id, actionsByCourse.get(c.course_id) ?? []),
    });
  }
  return sortByUrgency(rows);
}

/** Listado + las empresas del tenant (para el filtro). Audita la consulta. */
export async function listExpirations(
  principal: Principal,
  filter: ExpirationsFilter = {},
  nowMs: number = Date.now(),
): Promise<ExpirationsReport | null> {
  if (!canView(principal)) return null;
  const tenantId = principal.tenantId!;
  const guard = tenantGuard(tenantId);

  const [rows, companies] = await Promise.all([
    buildRows(guard, tenantId, filter, nowMs),
    fetchAll<{ id: string; razon_social: string }>((offset) =>
      guard.db.from("companies").select("id, razon_social").eq("tenant_id", tenantId).order("razon_social").range(offset, offset + PAGE - 1),
    ),
  ]);

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "certificates.expiry_report_viewed",
    entity: "certificates",
    entityId: tenantId,
    details: { count: rows.length, companyId: filter.companyId ?? null, windowDays: filter.windowDays ?? null },
  });

  return { rows, companies: companies.map((c) => ({ id: c.id, razonSocial: c.razon_social })) };
}

/** Export XLSX de las MISMAS filas. Audita `certificates.expiry_report_downloaded`. */
export async function buildExpirationsXlsx(
  principal: Principal,
  filter: ExpirationsFilter,
  labels: ExpirationExportLabels,
  nowMs: number = Date.now(),
): Promise<ExpirationsExport | null> {
  if (!canView(principal)) return null;
  const tenantId = principal.tenantId!;
  const guard = tenantGuard(tenantId);

  const rows = await buildRows(guard, tenantId, filter, nowMs);
  // TODA celda de texto pasa por el saneado anti-fórmula (D-021): los nombres y
  // las razones sociales vienen del roster/alta, o sea de entrada de terceros.
  const headers = EXPIRATION_EXPORT_HEADERS.map(sanitizeXlsxCell);
  const values = rows.map((r) => expirationExportRowValues(r, labels).map(sanitizeXlsxCell));
  const buffer = await buildXlsx("Vencimientos", headers, values);

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "certificates.expiry_report_downloaded",
    entity: "certificates",
    entityId: tenantId,
    details: { count: rows.length, companyId: filter.companyId ?? null, windowDays: filter.windowDays ?? null },
  });

  return { filename: "vencimientos_certificados", buffer };
}
