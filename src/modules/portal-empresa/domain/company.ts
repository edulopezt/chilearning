import { z } from "zod";

import { maskRun } from "@/modules/certificados/domain/folio";
import { santiagoDate } from "@/modules/reportes/domain/cumplimiento";
import { isValidRun, normalizeRun } from "@/modules/sence/domain/run";

/**
 * Dominio puro del Portal de la EMPRESA CLIENTE (task 5.2, HU-8.1). Sin IO.
 *
 * Qué modela: la identidad de la empresa (RUT + razón social) y la FILA que RRHH
 * ve de cada trabajador suyo — avance, asistencia, nota y certificado — con el
 * RUN SIEMPRE enmascarado (ruling aprobado: la empresa NO necesita el RUN
 * completo para hacer seguimiento; minimización de la Ley 21.719).
 *
 * ⚠ El RUT/DV NO se reimplementa aquí: se reusa `@/modules/sence/domain/run`
 * (ver nota en `normalizeRut`). El enmascarado se reusa de `certificados`.
 */

/**
 * RUT de empresa = mismo formato y DV módulo 11 que el RUN de una persona.
 *
 * Se REUSA el validador de `sence/domain/run` en vez de duplicarlo. La regla dura
 * es que `src/modules/sence/` no se TOCA y que no puede importar hacia afuera
 * (eslint.config.mjs lo bloquea en esa dirección); importar DESDE fuera hacia
 * `sence` está permitido y es el patrón ya establecido en `academico`
 * (`domain/enrollment-import.ts`) y `core` (`sence-config.ts`). Duplicar el
 * módulo-11 crearía una SEGUNDA fuente de verdad para un dígito verificador que
 * SENCE valida: si divergieran, esta UI aceptaría un RUT que el preflight rechaza.
 */
export function normalizeRut(raw: string): string {
  return normalizeRun(raw);
}

/** True si el RUT tiene forma normativa (`xxxxxxxx-x`) y DV módulo 11 correcto. */
export function isValidRut(raw: string): boolean {
  return isValidRun(raw);
}

/** Alta de empresa cliente. El RUT se NORMALIZA antes de validar el DV. */
export const createCompanySchema = z.object({
  // `max(20)` es sobre el RAW (admite "77.123.456-9" y espacios); tras normalizar
  // el valor cabe en el `check (length between 3 and 12)` de la tabla.
  rut: z
    .string()
    .trim()
    .min(3)
    .max(20)
    .transform(normalizeRut)
    .refine(isValidRut, { message: "RUT inválido" }),
  razonSocial: z.string().trim().min(1).max(200),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

/** Invitación de una persona de RRHH a una empresa del tenant. */
export const inviteMemberSchema = z.object({
  companyId: z.string().uuid(),
  email: z.string().trim().email().max(320),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/** Vinculación de una inscripción a una empresa (o `null` = alumno particular). */
export const assignEnrollmentSchema = z.object({
  enrollmentId: z.string().uuid(),
  companyId: z.string().uuid().nullable(),
});

/**
 * Neutraliza la inyección de fórmulas en XLSX (CWE-1236, D-021).
 *
 * `toCsv` (reportes/domain/cumplimiento) ya lo resuelve para CSV con esta MISMA
 * regla; para XLSX hay que hacerlo a mano porque `buildXlsx` escribe el valor
 * tal cual y Excel evalúa la celda al abrir. Los nombres vienen del roster
 * importado, o sea de entrada de terceros: se antepone `'` si el valor empieza
 * con `=`, `+`, `-`, `@`, TAB o CR.
 */
export function sanitizeXlsxCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export interface CompanyPanelEnrollment {
  readonly enrollmentId: string;
  readonly firstNames: string | null;
  readonly lastNames: string | null;
  readonly run: string;
  /** Becario/exento: no registra asistencia SENCE (I-14). */
  readonly exento: boolean;
}

export interface CompanyPanelSession {
  readonly enrollmentId: string;
  readonly status: string;
  /** epoch ms de `opened_at` (o `created_at` como respaldo de atribución). */
  readonly atMs: number;
}

export interface CompanyPanelCertificate {
  readonly enrollmentId: string;
  readonly folio: string;
  readonly status: string;
}

export interface CompanyPanelInputs {
  readonly enrollments: readonly CompanyPanelEnrollment[];
  /** Lecciones PUBLICADAS del curso: denominador del avance. */
  readonly totalLessons: number;
  /** Una entrada por lección COMPLETADA (el llamador ya filtró `completed`). */
  readonly completedLessons: readonly { readonly enrollmentId: string }[];
  readonly sessions: readonly CompanyPanelSession[];
  /** inscripción → nota final PUBLICADA del libro oficial; ausente = sin nota. */
  readonly grades: ReadonlyMap<string, number>;
  /** Certificados ordenados del más reciente al más antiguo por inscripción. */
  readonly certificates: readonly CompanyPanelCertificate[];
}

export interface CompanyPanelRow {
  readonly enrollmentId: string;
  /** "Apellidos, Nombres" (misma convención que el libro de notas). */
  readonly nombre: string;
  /** RUN SIEMPRE enmascarado: la empresa nunca ve el RUN completo. */
  readonly runMasked: string;
  readonly exento: boolean;
  /** 0–100 sobre las lecciones publicadas del curso. */
  readonly progressPct: number;
  /** Días DISTINTOS (hora de Santiago) con al menos una sesión CERRADA. */
  readonly attendanceDays: number;
  /** Nota final publicada, o null si aún no hay ninguna nota publicada. */
  readonly grade: number | null;
  readonly certificateFolio: string | null;
  readonly certificateStatus: string | null;
}

/** "Apellidos, Nombres" — convención del libro de notas (gradebook-service). */
function personName(firstNames: string | null, lastNames: string | null): string {
  const first = (firstNames ?? "").trim();
  const last = (lastNames ?? "").trim();
  if (last) return first ? `${last}, ${first}` : last;
  return first || "—";
}

/**
 * Filas del panel de la empresa: cruza inscripciones × progreso × sesiones ×
 * notas × certificados. El llamador YA acotó las entradas a los trabajadores de
 * la empresa (este dominio no sabe de empresas: solo consolida lo que recibe).
 *
 * Solo la sesión `cerrada` cuenta como asistencia (una `iniciada` sin cierre no
 * es evidencia ante SENCE), y cuenta por DÍA distinto: dos sesiones el mismo día
 * son un día. Sin nota publicada → `null` (jamás se muestra un borrador).
 */
export function companyPanelRows(inputs: CompanyPanelInputs): CompanyPanelRow[] {
  const completedByEnrollment = new Map<string, number>();
  for (const p of inputs.completedLessons) {
    completedByEnrollment.set(p.enrollmentId, (completedByEnrollment.get(p.enrollmentId) ?? 0) + 1);
  }

  const daysByEnrollment = new Map<string, Set<string>>();
  for (const s of inputs.sessions) {
    if (s.status !== "cerrada") continue;
    let days = daysByEnrollment.get(s.enrollmentId);
    if (!days) {
      days = new Set<string>();
      daysByEnrollment.set(s.enrollmentId, days);
    }
    days.add(santiagoDate(s.atMs));
  }

  // El primero gana: el llamador entrega los certificados del más reciente al
  // más antiguo, así una reemisión no queda tapada por el folio viejo.
  const certByEnrollment = new Map<string, CompanyPanelCertificate>();
  for (const c of inputs.certificates) {
    if (!certByEnrollment.has(c.enrollmentId)) certByEnrollment.set(c.enrollmentId, c);
  }

  return inputs.enrollments
    .map((e) => {
      const completed = completedByEnrollment.get(e.enrollmentId) ?? 0;
      // Curso sin lecciones publicadas: 0 % (no hay avance que medir, y jamás
      // una división por cero disfrazada de 100 %).
      const progressPct =
        inputs.totalLessons > 0
          ? Math.round((Math.min(completed, inputs.totalLessons) / inputs.totalLessons) * 100)
          : 0;
      const cert = certByEnrollment.get(e.enrollmentId) ?? null;
      return {
        enrollmentId: e.enrollmentId,
        nombre: personName(e.firstNames, e.lastNames),
        runMasked: maskRun(e.run),
        exento: e.exento,
        progressPct,
        attendanceDays: daysByEnrollment.get(e.enrollmentId)?.size ?? 0,
        grade: inputs.grades.get(e.enrollmentId) ?? null,
        certificateFolio: cert?.folio ?? null,
        certificateStatus: cert?.status ?? null,
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es-CL"));
}

/** Rótulos del export de la empresa (es-CL: lo abre RRHH, no un fiscalizador). */
export const COMPANY_EXPORT_HEADERS = [
  "TRABAJADOR(A)",
  "RUN",
  "AVANCE %",
  "DIAS CON ASISTENCIA",
  "NOTA",
  "CERTIFICADO",
  "ESTADO CERTIFICADO",
] as const;

/** Valores de una fila del export, en el orden de `COMPANY_EXPORT_HEADERS`. */
export function companyExportRowValues(row: CompanyPanelRow): string[] {
  return [
    row.nombre,
    row.runMasked,
    String(row.progressPct),
    String(row.attendanceDays),
    row.grade === null ? "" : row.grade.toFixed(1),
    row.certificateFolio ?? "",
    row.certificateStatus ?? "",
  ];
}
