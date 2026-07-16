import "server-only";

import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import {
  buildAttendanceMatrix,
  businessDays,
  formatSantiago,
  santiagoDate,
  topErrors,
  type ExportRow,
  type FrequentError,
  type MatrixSession,
  type MatrixStudent,
  type StudentDayRow,
} from "@/modules/reportes/domain/cumplimiento";

/**
 * Task 2.4 (HU-5.5) — servicio del panel de cumplimiento SENCE por acción.
 * Patrón de agregación del tablero (instructor-board): lecturas acotadas al
 * tenant vía guard + agregación en memoria + fórmulas en dominio puro.
 *
 * Acceso STAFF (otec_admin/coordinator). El fiscalizador ya NO entra por acá
 * directo (task 3.11): su acceso es GATED por `supervisor-portal-service`, que
 * verifica grant vigente + alcance + audita, y luego invoca las variantes
 * `*Unchecked` de este servicio. Así ninguna ruta expone datos al supervisor sin
 * pasar por el grant.
 *
 * Lecturas de sesiones/eventos SIEMPRE paginadas con join embebido (lecciones
 * de los PR #31/#32/#33: PostgREST capa en max_rows=1000 en silencio y `.in()`
 * con listas grandes revienta el URI).
 */

const STAFF = ["otec_admin", "coordinator"] as const;
const PAGE = 1000;
const MAX_PAGES = 20;

export interface CompliancePanel {
  readonly actionId: string;
  readonly courseName: string;
  readonly codigoAccion: string;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly days: readonly string[];
  readonly rows: readonly StudentDayRow[];
  readonly frequentErrors: readonly FrequentError[];
  /** true si el barrido tocó el tope de páginas (datos posiblemente parciales). */
  readonly truncated: boolean;
}

export interface ComplianceActionSummary {
  readonly actionId: string;
  readonly courseName: string;
  readonly codigoAccion: string;
  readonly environment: string;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly enrolled: number;
}

interface SessionRow {
  enrollment_id: string;
  status: string;
  opened_at: string | null;
  created_at: string;
  id_sesion_sence: string | null;
  sence_course_code: string | null;
  action_code: string;
  run_alumno: string;
}

function canView(principal: Principal): boolean {
  return Boolean(principal.tenantId) && authorize(principal, principal.tenantId!, STAFF);
}

/** Índice de acciones visibles para el staff del tenant. */
export async function listComplianceActions(
  principal: Principal,
): Promise<ComplianceActionSummary[]> {
  if (!canView(principal)) return [];
  return listComplianceActionsUnchecked(principal);
}

/** Igual que `listComplianceActions` pero SIN authz: solo para llamadores que ya
 *  autorizaron (p. ej. `supervisor-portal-service` tras verificar el grant). */
export async function listComplianceActionsUnchecked(
  principal: Principal,
): Promise<ComplianceActionSummary[]> {
  const guard = tenantGuard(principal.tenantId!);
  const [{ data: actions }, { data: courses }, { data: enrollments }] = await Promise.all([
    guard
      .from("actions")
      .select("id, course_id, codigo_accion, environment, starts_on, ends_on"),
    guard.from("courses").select("id, name"),
    guard.from("enrollments").select("id, action_id"),
  ]);
  const courseName = new Map(
    ((courses ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );
  const enrolledByAction = new Map<string, number>();
  for (const e of (enrollments ?? []) as { action_id: string }[]) {
    enrolledByAction.set(e.action_id, (enrolledByAction.get(e.action_id) ?? 0) + 1);
  }
  return ((actions ?? []) as {
    id: string;
    course_id: string;
    codigo_accion: string;
    environment: string;
    starts_on: string | null;
    ends_on: string | null;
  }[])
    .map((a) => ({
      actionId: a.id,
      courseName: courseName.get(a.course_id) ?? "—",
      codigoAccion: a.codigo_accion,
      environment: a.environment,
      startsOn: a.starts_on,
      endsOn: a.ends_on,
      enrolled: enrolledByAction.get(a.id) ?? 0,
    }))
    .sort((a, b) => (b.startsOn ?? "").localeCompare(a.startsOn ?? ""));
}

async function fetchActionContext(principal: Principal, actionId: string) {
  const guard = tenantGuard(principal.tenantId!);
  const { data: action } = await guard
    .from("actions")
    .select("id, course_id, codigo_accion, starts_on, ends_on")
    .eq("id", actionId)
    .maybeSingle();
  if (!action) return null;

  const [{ data: course }, { data: enrollments }] = await Promise.all([
    guard.db
      .from("courses")
      .select("name")
      .eq("id", action.course_id as string)
      .eq("tenant_id", principal.tenantId!)
      .maybeSingle(),
    guard.db
      .from("enrollments")
      .select("id, run, exento, first_names, last_names")
      .eq("tenant_id", principal.tenantId!)
      .eq("action_id", actionId),
  ]);

  const { rows: sessions, truncated } = await fetchSessions(guard.db, actionId);
  return { guard, action, course, enrollments: enrollments ?? [], sessions, truncated };
}

/** Sesiones de la acción, paginadas, vía join embebido a enrollments. */
async function fetchSessions(
  db: ReturnType<typeof tenantGuard>["db"],
  actionId: string,
): Promise<{ rows: SessionRow[]; truncated: boolean }> {
  const rows: SessionRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE;
    const { data, error } = await db
      .from("sence_sessions")
      .select(
        "enrollment_id, status, opened_at, created_at, id_sesion_sence, sence_course_code, action_code, run_alumno, enrollments!inner(action_id)",
      )
      .eq("enrollments.action_id", actionId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) break;
    const batch = (data ?? []) as unknown as SessionRow[];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** Eventos de error de la acción (join anidado sesión→enrollment), paginados. */
async function fetchErrorEvents(
  db: ReturnType<typeof tenantGuard>["db"],
  actionId: string,
): Promise<{ errorCodes: string[] }[]> {
  const rows: { errorCodes: string[] }[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE;
    const { data, error } = await db
      .from("sence_events")
      .select("error_codes, sence_sessions!inner(enrollments!inner(action_id))")
      .eq("sence_sessions.enrollments.action_id", actionId)
      .in("kind", ["start_error", "close_error"])
      .order("received_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) break;
    const batch = (data ?? []) as unknown as { error_codes: string[] }[];
    rows.push(...batch.map((r) => ({ errorCodes: r.error_codes ?? [] })));
    if (batch.length < PAGE) break;
  }
  return rows;
}

export async function getCompliancePanel(
  principal: Principal,
  actionId: string,
): Promise<CompliancePanel | null> {
  if (!canView(principal)) return null;
  return compliancePanelUnchecked(principal, actionId);
}

/** Panel SIN authz: solo para llamadores ya autorizados (portal-service gated). */
export async function compliancePanelUnchecked(
  principal: Principal,
  actionId: string,
): Promise<CompliancePanel | null> {
  const ctx = await fetchActionContext(principal, actionId);
  if (!ctx) return null;

  const students: MatrixStudent[] = (ctx.enrollments as {
    id: string;
    run: string;
    exento: boolean;
    first_names: string | null;
    last_names: string | null;
  }[])
    .map((e) => ({
      enrollmentId: e.id,
      nombres: e.first_names ?? "",
      apellidos: e.last_names ?? "",
      run: e.run,
      exento: e.exento,
    }))
    .sort((a, b) => `${a.apellidos} ${a.nombres}`.localeCompare(`${b.apellidos} ${b.nombres}`));

  const sessions: MatrixSession[] = ctx.sessions.map((s) => ({
    enrollmentId: s.enrollment_id,
    status: s.status,
    openedAtMs: s.opened_at ? Date.parse(s.opened_at) : null,
    createdAtMs: Date.parse(s.created_at),
  }));

  const days = businessDays(
    (ctx.action.starts_on as string | null) ?? null,
    (ctx.action.ends_on as string | null) ?? null,
    santiagoDate(Date.now()),
  );

  const events = await fetchErrorEvents(ctx.guard.db, actionId);

  return {
    actionId,
    courseName: (ctx.course?.name as string) ?? "—",
    codigoAccion: ctx.action.codigo_accion as string,
    startsOn: (ctx.action.starts_on as string | null) ?? null,
    endsOn: (ctx.action.ends_on as string | null) ?? null,
    days,
    rows: buildAttendanceMatrix(days, students, sessions),
    frequentErrors: topErrors(events),
    truncated: ctx.truncated,
  };
}

export interface ComplianceExport {
  readonly filename: string;
  readonly rows: ExportRow[];
}

/** Filas del export (Excel/CSV): una por sesión con inicio confirmado,
 *  orden `opened_at DESC` — réplica del reporte del plugin. */
export async function getComplianceExport(
  principal: Principal,
  actionId: string,
): Promise<ComplianceExport | null> {
  if (!canView(principal)) return null;
  return complianceExportUnchecked(principal, actionId);
}

/** Export SIN authz: solo para llamadores ya autorizados (portal-service gated). */
export async function complianceExportUnchecked(
  principal: Principal,
  actionId: string,
): Promise<ComplianceExport | null> {
  const ctx = await fetchActionContext(principal, actionId);
  if (!ctx) return null;

  const nameByEnrollment = new Map(
    (ctx.enrollments as {
      id: string;
      first_names: string | null;
      last_names: string | null;
    }[]).map((e) => [e.id, { nombres: e.first_names ?? "", apellidos: e.last_names ?? "" }]),
  );
  const courseName = (ctx.course?.name as string) ?? "";

  const rows: ExportRow[] = ctx.sessions
    .filter((s) => s.opened_at !== null)
    .sort((a, b) => Date.parse(b.opened_at as string) - Date.parse(a.opened_at as string))
    .map((s) => {
      const names = nameByEnrollment.get(s.enrollment_id) ?? { nombres: "", apellidos: "" };
      return {
        curso: courseName,
        nombres: names.nombres,
        apellidos: names.apellidos,
        run: s.run_alumno,
        // Quirk I-10 preservado del plugin: "CODIGO CURSO" = CodSence del curso
        // y "ID SENCE" = código de la ACCIÓN. La columna extra trae el id real.
        codigoCurso: s.sence_course_code ?? "",
        idSence: s.action_code,
        fechaHora: formatSantiago(Date.parse(s.opened_at as string)),
        idSesionSence: s.id_sesion_sence ?? "",
      };
    });

  return {
    filename: `asistencia_sence-accion_${(ctx.action.codigo_accion as string).replace(/[^\w.-]/g, "_")}`,
    rows,
  };
}
