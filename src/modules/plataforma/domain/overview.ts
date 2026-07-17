/**
 * Dominio puro del tablero superadmin (task 5.5, HU-10.3). Sin IO: agrega y
 * ordena las métricas de negocio que devuelve la RPC `platform_tenant_stats`.
 *
 * Restricción de rol (spec §3): aquí SOLO viven agregados (conteos, fechas).
 * Ningún campo identifica a un alumno — si algún día alguien intenta colar PII
 * en este tipo, el test de forma de la suite RLS lo caza.
 */

export type TenantStatus = "active" | "suspended";

/** Fila de métricas por tenant (espejo exacto del retorno de la RPC). */
export interface TenantStatsRow {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly plan: string;
  readonly status: TenantStatus;
  readonly createdAt: string;
  readonly students: number;
  readonly enrollments: number;
  readonly actions: number;
  readonly courses: number;
  readonly certificates: number;
  readonly openAlerts: number;
  readonly senceErrorAlerts7d: number;
  readonly lastEnrollmentAt: string | null;
}

/** Totales de plataforma para las tarjetas de resumen. */
export interface PlatformSummary {
  readonly totalTenants: number;
  readonly active: number;
  readonly suspended: number;
  readonly totalStudents: number;
  readonly totalEnrollments: number;
  readonly openAlerts: number;
}

/** Suma los agregados de todos los tenants. Lista vacía => todo en cero. */
export function summarize(rows: readonly TenantStatsRow[]): PlatformSummary {
  return rows.reduce<PlatformSummary>(
    (acc, row) => ({
      totalTenants: acc.totalTenants + 1,
      active: acc.active + (row.status === "active" ? 1 : 0),
      suspended: acc.suspended + (row.status === "suspended" ? 1 : 0),
      totalStudents: acc.totalStudents + row.students,
      totalEnrollments: acc.totalEnrollments + row.enrollments,
      openAlerts: acc.openAlerts + row.openAlerts,
    }),
    {
      totalTenants: 0,
      active: 0,
      suspended: 0,
      totalStudents: 0,
      totalEnrollments: 0,
      openAlerts: 0,
    },
  );
}

/**
 * Orden del tablero: primero lo que EXIGE acción del superadmin.
 *   1) Tenants suspendidos (servicio cortado: lo más urgente).
 *   2) Tenants con alertas abiertas.
 *   3) El resto, por volumen de inscripciones (desc).
 * Desempate final por slug: orden estable y determinista (la RPC no garantiza
 * orden y `Array.prototype.sort` solo es estable dentro de una misma corrida).
 */
export function sortForBoard(rows: readonly TenantStatsRow[]): TenantStatsRow[] {
  const rank = (row: TenantStatsRow): number => {
    if (row.status === "suspended") return 0;
    if (row.openAlerts > 0) return 1;
    return 2;
  };
  return [...rows].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    const byEnrollments = b.enrollments - a.enrollments;
    if (byEnrollments !== 0) return byEnrollments;
    return a.slug.localeCompare(b.slug);
  });
}
