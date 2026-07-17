import type { SupabaseClient } from "@supabase/supabase-js";

import { santiagoDate } from "@/modules/reportes/domain/cumplimiento";

/**
 * Datos AGREGADOS del resumen semanal de la empresa cliente (HU-8.2).
 *
 * ⚠ Sin `import "server-only"`: lo consumirá el proceso WORKER (fuera de React
 * Server Components), igual que `comunicacion/email-sender`.
 *
 * // El job "weekly-company-digest" + la redacción IA llegan en la task 5.9.
 * Hoy NO tiene llamadores: es el punto de extensión acordado para que 5.9 no
 * tenga que re-derivar los agregados ni, peor, mandarle filas de trabajadores a
 * un modelo.
 *
 * Contrato de privacidad (RNF-10 + HU-8.2 CA): aquí SOLO salen CONTEOS. Ningún
 * nombre, RUN, correo ni id de persona. Lo único identificatorio es la razón
 * social — que es la empresa DESTINATARIA del correo, no un dato personal — y
 * aun así la redacción IA de 5.9 debe armarse con los agregados, no con ella.
 */

export interface CompanyWeeklySummaryData {
  readonly companyId: string;
  readonly razonSocial: string;
  /** Inicio del período (ISO). El fin es "ahora". */
  readonly sinceIso: string;
  /** Trabajadores vinculados a la empresa (todas las acciones). */
  readonly workers: number;
  /** Acciones distintas con al menos un trabajador de la empresa. */
  readonly actions: number;
  /** Lecciones completadas DURANTE el período (avance de la semana). */
  readonly lessonsCompletedInPeriod: number;
  /**
   * Pares (trabajador, día de Santiago) con asistencia SENCE cerrada en el
   * período. El día se atribuye por `opened_at`, igual que el panel y el reporte
   * oficial de cumplimiento.
   */
  readonly attendanceDaysInPeriod: number;
  /** Notas publicadas en el período. */
  readonly gradesPublishedInPeriod: number;
  /** Certificados emitidos en el período. */
  readonly certificatesIssuedInPeriod: number;
}

const PAGE = 1000;
const IN_CHUNK = 100;

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

/**
 * Recolecta los agregados del período para UNA empresa.
 *
 * `db` debe ser un cliente service-role (el worker no tiene sesión): por eso
 * TODA consulta filtra por `tenant_id` explícito — el llamador es responsable de
 * pasar el tenant correcto, igual que en el resto del worker.
 *
 * Devuelve null si la empresa no existe en ese tenant.
 */
export async function collectWeeklySummaryData(
  db: SupabaseClient,
  tenantId: string,
  companyId: string,
  sinceIso: string,
): Promise<CompanyWeeklySummaryData | null> {
  const { data: company } = await db
    .from("companies")
    .select("id, razon_social")
    .eq("tenant_id", tenantId)
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return null;

  const enrollments = await fetchAll<{ id: string; action_id: string }>((offset) =>
    db
      .from("enrollments")
      .select("id, action_id")
      .eq("tenant_id", tenantId)
      .eq("company_id", companyId)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1),
  );

  const base = {
    companyId,
    razonSocial: company.razon_social as string,
    sinceIso,
    workers: enrollments.length,
    actions: new Set(enrollments.map((e) => e.action_id)).size,
  };
  if (enrollments.length === 0) {
    return {
      ...base,
      lessonsCompletedInPeriod: 0,
      attendanceDaysInPeriod: 0,
      gradesPublishedInPeriod: 0,
      certificatesIssuedInPeriod: 0,
    };
  }

  const ids = enrollments.map((e) => e.id);
  const [progress, sessions, grades, certificates] = await Promise.all([
    fetchChunked<{ id: string }>(ids, (chunk, offset) =>
      db
        .from("lesson_progress")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("completed", true)
        .gte("completed_at", sinceIso)
        .in("enrollment_id", chunk)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
    ),
    // El PERÍODO se filtra por `closed_at` (la sesión CERRÓ esta semana), pero el
    // DÍA se atribuye por `opened_at ?? created_at`: ver la nota del cómputo.
    fetchChunked<{ enrollment_id: string; opened_at: string | null; created_at: string }>(
      ids,
      (chunk, offset) =>
        db
          .from("sence_sessions")
          .select("enrollment_id, opened_at, created_at, id")
          .eq("tenant_id", tenantId)
          .eq("status", "cerrada")
          .gte("closed_at", sinceIso)
          .in("enrollment_id", chunk)
          .order("id", { ascending: true })
          .range(offset, offset + PAGE - 1),
    ),
    fetchChunked<{ id: string }>(ids, (chunk, offset) =>
      db
        .from("grades")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("status", "published")
        .gte("published_at", sinceIso)
        .in("enrollment_id", chunk)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
    ),
    fetchChunked<{ id: string }>(ids, (chunk, offset) =>
      db
        .from("certificates")
        .select("id")
        .eq("tenant_id", tenantId)
        .gte("issued_at", sinceIso)
        .in("enrollment_id", chunk)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1),
    ),
  ]);

  // Un trabajador con dos sesiones el mismo día es UN día con asistencia — y "día"
  // significa EXACTAMENTE lo mismo que en el resto de la app, no algo parecido:
  //  · Zona: `santiagoDate` (America/Santiago). `closed_at`/`opened_at` son
  //    `timestamptz` y PostgREST los serializa en UTC; cortar el ISO con
  //    `.slice(0, 10)` daba la fecha UTC, y Chile es UTC-4/-3 → toda sesión de las
  //    20:00 en adelante caía al día siguiente. Un adulto que estudia de noche es
  //    justo el público de esto.
  //  · Ancla: `opened_at ?? created_at`, igual que `companyPanelRows`
  //    (company-portal-service) y que el cálculo OFICIAL de cumplimiento SENCE
  //    (`buildAttendanceMatrix`, reportes/domain/cumplimiento). Anclar en
  //    `closed_at` partía en dos una sesión abierta el día N y cerrada el N+1.
  // Si divergen, el correo semanal contradice al panel que la MISMA RRHH mira, y a
  // la asistencia que el coordinador reporta a SENCE.
  const attendanceDays = new Set(
    sessions.map(
      (s) => `${s.enrollment_id}|${santiagoDate(Date.parse(s.opened_at ?? s.created_at))}`,
    ),
  );

  return {
    ...base,
    lessonsCompletedInPeriod: progress.length,
    attendanceDaysInPeriod: attendanceDays.size,
    gradesPublishedInPeriod: grades.length,
    certificatesIssuedInPeriod: certificates.length,
  };
}
