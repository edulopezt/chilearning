/**
 * Dominio puro de derechos de datos Ley 21.719 (task 3.5, HU-2.4 / RNF-3). Sin IO.
 * El catálogo de retención vive en código (versionado/auditable, P1) y se muestra
 * read-only en la UI; los períodos quedan FLAGGED para revisión legal antes del
 * lanzamiento comercial (spec §9). La supresión conserva los registros SENCE.
 */

export const CURRENT_PRIVACY_POLICY_VERSION = "2026-07";

export const DSR_KINDS = ["access", "rectification", "erasure", "portability"] as const;
export type DsrKind = (typeof DSR_KINDS)[number];

export interface RetentionPolicy {
  readonly dataType: string;
  /** true = se conserva por obligación legal aunque el titular pida supresión. */
  readonly retained: boolean;
  readonly periodLabel: string;
  readonly basis: string;
}

// ⚠ Períodos FLAGGED para revisión legal (abogado, Hito 5). Defaults razonables.
export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  { dataType: "Asistencia SENCE (sesiones y eventos)", retained: true, periodLabel: "≥ 5 años", basis: "Obligación de fiscalización SENCE (Estatuto de Capacitación)" },
  { dataType: "Certificados emitidos", retained: true, periodLabel: "≥ 5 años", basis: "Documento oficial de la OTEC / evidencia de fiscalización" },
  { dataType: "Calificaciones (libro de notas)", retained: true, periodLabel: "≥ 5 años", basis: "Evidencia del cumplimiento de la acción" },
  { dataType: "Bitácora de auditoría (audit_log)", retained: true, periodLabel: "≥ 5 años", basis: "Trazabilidad e integridad (P8), INSERT-only" },
  { dataType: "Datos de perfil (nombre de usuario, preferencias)", retained: false, periodLabel: "Hasta la supresión", basis: "Consentimiento del titular" },
  { dataType: "Mensajería y foro", retained: false, periodLabel: "Hasta la supresión", basis: "Servicio de comunicación del curso" },
  { dataType: "Respuestas de encuesta anónimas", retained: false, periodLabel: "Agregado, no atribuible", basis: "Sin datos personales (anónimas)" },
];

export interface ProcessingActivity {
  readonly purpose: string;
  readonly dataCategories: string;
  readonly basis: string;
}

export const PROCESSING_ACTIVITIES: readonly ProcessingActivity[] = [
  { purpose: "Impartir el curso y registrar el progreso", dataCategories: "Identidad, RUN, progreso, calificaciones", basis: "Ejecución del servicio de capacitación" },
  { purpose: "Validar la asistencia ante SENCE (RCE)", dataCategories: "RUN, sesiones SENCE", basis: "Obligación legal (franquicia tributaria SENCE)" },
  { purpose: "Emitir certificados", dataCategories: "Identidad, RUN, nota, asistencia", basis: "Documento de la OTEC" },
  { purpose: "Comunicación del curso (avisos, mensajería)", dataCategories: "Identidad, correo", basis: "Ejecución del servicio" },
  { purpose: "Auditoría y seguridad", dataCategories: "Id de usuario, acciones", basis: "Interés legítimo / trazabilidad" },
];

export interface ErasureClassification {
  readonly erasable: readonly string[];
  readonly retained: readonly { dataType: string; reason: string }[];
}

/** Clasifica los datos del titular en suprimibles vs. conservados (con motivo). */
export function classifyForErasure(): ErasureClassification {
  return {
    erasable: RETENTION_POLICIES.filter((p) => !p.retained).map((p) => p.dataType),
    retained: RETENTION_POLICIES.filter((p) => p.retained).map((p) => ({ dataType: p.dataType, reason: p.basis })),
  };
}

export interface FieldError {
  readonly field: string;
  readonly message: string;
}
export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

export interface DsrInput {
  readonly kind: DsrKind;
  readonly detail: string;
}

export function parseDsrInput(raw: { kind?: unknown; detail?: unknown }): ParseResult<DsrInput> {
  const errors: FieldError[] = [];
  const kind = String(raw.kind ?? "") as DsrKind;
  if (!DSR_KINDS.includes(kind)) errors.push({ field: "kind", message: "Tipo de solicitud inválido." });
  const detail = String(raw.detail ?? "").trim();
  if (detail.length > 4000) errors.push({ field: "detail", message: "El detalle es demasiado largo." });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { kind, detail } };
}
