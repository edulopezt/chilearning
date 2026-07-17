/**
 * Dominio puro del listado de vencimientos (task 5.12, HU-7.3). Sin IO.
 *
 * Modela la FILA que ve el coordinador (y, recortada, la empresa) y los rótulos
 * del export. El RUN va SIEMPRE enmascarado: para decidir a quién recertificar
 * basta el nombre (minimización, Ley 21.719 — mismo criterio que el portal de
 * la empresa en `portal-empresa/domain/company.ts`).
 */

/** Lo que ven TODOS (staff y empresa). Sin ids internos ni RUN completo. */
export interface ExpirationRowBase {
  readonly certificateId: string;
  readonly folio: string;
  /** "Apellidos, Nombres" (convención del libro de notas). */
  readonly studentName: string;
  readonly runMasked: string;
  readonly courseName: string;
  readonly codigoAccion: string;
  readonly expiresAt: string;
  /** Días de calendario que faltan; NEGATIVO = ya vencido (el listado sí lo muestra). */
  readonly daysLeft: number;
}

/** Fila del panel /admin: agrega empresa y el destino de re-inscripción. */
export interface ExpirationRow extends ExpirationRowBase {
  readonly courseId: string;
  readonly actionId: string;
  readonly companyId: string | null;
  /** Razón social, o null si el alumno es particular (no lo manda una empresa). */
  readonly razonSocial: string | null;
  /**
   * Acción a la que apunta el enlace de re-inscripción: otra acción del MISMO
   * curso, distinta de la que certificó. null = todavía no existe (la UI manda
   * a crearla). Ver la nota de `pickRecertifyAction`.
   */
  readonly recertifyActionId: string | null;
}

/**
 * Elige la acción destino para recertificar: la MÁS RECIENTE del mismo curso
 * que no sea la que ya certificó a esa persona.
 *
 * Por qué "la más reciente" y no "una futura": una acción puede no tener
 * `starts_on` todavía (se crea en borrador y se le ponen fechas al activarla —
 * D-025), así que filtrar por fecha futura dejaría fuera justo a la acción
 * recién clonada para la nueva versión del curso, que es el caso típico. Se
 * ordena por `starts_on` desc con `createdAt` de desempate, y las sin fecha van
 * primero: son las candidatas más probables.
 *
 * `candidates` debe traer SOLO acciones del mismo curso y del mismo tenant (el
 * llamador ya filtró: este dominio no sabe de tenants).
 */
export function pickRecertifyAction(
  certifiedActionId: string,
  candidates: readonly { readonly id: string; readonly startsOn: string | null; readonly createdAt: string }[],
): string | null {
  const others = candidates.filter((a) => a.id !== certifiedActionId);
  if (others.length === 0) return null;
  const sorted = [...others].sort((a, b) => {
    // Sin fecha primero (recién creada, aún sin programar).
    if (a.startsOn === null && b.startsOn !== null) return -1;
    if (b.startsOn === null && a.startsOn !== null) return 1;
    if (a.startsOn !== null && b.startsOn !== null && a.startsOn !== b.startsOn) {
      return b.startsOn.localeCompare(a.startsOn);
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
  return sorted[0]!.id;
}

/** Ordena por urgencia: lo más próximo a vencer (y lo ya vencido) primero. */
export function sortByUrgency<T extends { readonly expiresAt: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
}

/** Rótulos del export (es-CL: lo abre el coordinador o RRHH). */
export const EXPIRATION_EXPORT_HEADERS = [
  "TRABAJADOR(A)",
  "RUN",
  "CURSO",
  "CODIGO ACCION",
  "FOLIO",
  "VENCE EL",
  "DIAS RESTANTES",
  "EMPRESA",
] as const;

/** Rótulos inyectados por el llamador (el dominio no habla es-CL). */
export interface ExpirationExportLabels {
  /** Alumno sin empresa asociada. */
  readonly particular: string;
  /** Certificado ya vencido (en vez de un número negativo suelto). */
  readonly expired: string;
}

/** Fecha ISO → `dd-mm-aaaa` (formato es-CL, sin depender de Intl ni de TZ). */
export function formatExpiryDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

/** Valores de una fila del export, en el orden de `EXPIRATION_EXPORT_HEADERS`. */
export function expirationExportRowValues(row: ExpirationRow, labels: ExpirationExportLabels): string[] {
  return [
    row.studentName,
    row.runMasked,
    row.courseName,
    row.codigoAccion,
    row.folio,
    formatExpiryDate(row.expiresAt),
    row.daysLeft < 0 ? labels.expired : String(row.daysLeft),
    row.razonSocial ?? labels.particular,
  ];
}
