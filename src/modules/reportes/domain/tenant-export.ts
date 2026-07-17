// ⚠ SIN `import "server-only"`: lo ejecuta el proceso worker (job
// `tenant-export-tick`), fuera de Next. Imports RELATIVOS (mismo criterio que
// `sence/expiry.ts`, `comunicacion/reminders.ts`, `certificados/expiry-alerts.ts`).
import { toCsv } from "./cumplimiento";

/**
 * Dominio puro del export completo del tenant (task 5.13, HU-1.5). Sin IO: el
 * registro de datasets a exportar, la serialización CSV/JSON de cada uno, el
 * presupuesto de tamaño del ZIP y el manifiesto de contenido.
 *
 * ⚠ REGISTRO VERIFICADO CONTRA EL ESQUEMA REAL (no inventado): cada `table` y
 * `columns` de abajo se contrastó contra las migraciones de `supabase/migrations/`
 * al momento de escribir este archivo. Si el esquema cambia, este registro debe
 * actualizarse en el MISMO PR que lo cambie.
 *
 * ALCANCE (decisión de esta tarea, honesta sobre lo que NO entra):
 *  - `sence_otec_config` queda FUERA por completo: lleva `token_encrypted` (el
 *    token del OTEC), y la regla dura del proyecto es que ese token jamás
 *    aparece en logs, respuestas al cliente NI fixtures/exports — sin
 *    excepción, ni siquiera cifrado.
 *  - `questions` (pauta de los quizzes), `surveys`/`survey_submissions`/
 *    `survey_responses`, `calendar_items`, `dsr_requests`, `dj_checklist` y
 *    `supervisor_grant_actions` NO están en el registro: son datos reales del
 *    tenant, pero quedan fuera del alcance aprobado de ESTA tarea para mantener
 *    el PR revisable. Follow-up anotado para una iteración futura del export.
 *  - `certificate_expiry_config` SÍ se agregó (no estaba en la lista original):
 *    es la config hermana de `certificate_expiry_alerts` (misma tarea 5.12,
 *    ya en el esquema) y una fila por tenant no agrega riesgo ni volumen.
 *  - `submissions` y `action_documents` exportan METADATOS (sin el binario en
 *    el CSV/JSON); el archivo real se agrega al ZIP aparte, bajo presupuesto
 *    (ver `tenant-export-runner.ts`).
 *  - `sence_sessions` excluye `callback_nonce` (artefacto de seguridad de una
 *    URL de callback, no un dato de negocio) y `sence_events` NUNCA puede traer
 *    el Token por el propio CHECK de la tabla (`sence_events_no_token`).
 */

export interface OrderSpec {
  readonly column: string;
  readonly ascending?: boolean;
}

export interface ExportDatasetEntry {
  /** Nombre del dataset — nombre de archivo `datasets/<name>.csv|.json`. */
  readonly name: string;
  readonly table: string;
  readonly columns: readonly string[];
  readonly orderBy: readonly OrderSpec[];
  /** Columna de tenant a filtrar. Default `"tenant_id"`; excepción: `tenants` filtra por `"id"`. */
  readonly tenantColumn?: string;
}

const ID_ASC: readonly OrderSpec[] = [{ column: "id", ascending: true }];

export const EXPORT_DATASETS: readonly ExportDatasetEntry[] = [
  {
    name: "tenants",
    table: "tenants",
    tenantColumn: "id",
    columns: ["id", "slug", "name", "rut", "plan", "branding", "flags", "status", "created_at"],
    orderBy: ID_ASC,
  },
  {
    name: "memberships",
    table: "memberships",
    columns: ["id", "tenant_id", "user_id", "roles", "status", "created_at"],
    orderBy: ID_ASC,
  },
  {
    name: "courses",
    table: "courses",
    columns: [
      "id", "tenant_id", "name", "sence", "cod_sence", "modality", "hours",
      "completion_rules", "status", "validity_months", "created_at", "updated_at",
    ],
    orderBy: ID_ASC,
  },
  {
    name: "lessons",
    table: "lessons",
    columns: ["id", "tenant_id", "course_id", "title", "kind", "content", "position", "status", "created_at", "updated_at"],
    orderBy: ID_ASC,
  },
  {
    name: "actions",
    table: "actions",
    columns: [
      "id", "tenant_id", "course_id", "codigo_accion", "training_line", "environment",
      "attendance_lock", "starts_on", "ends_on", "status", "cloned_from",
      "min_attendance_pct_override", "created_at", "updated_at",
    ],
    orderBy: ID_ASC,
  },
  {
    name: "enrollments",
    table: "enrollments",
    columns: ["id", "tenant_id", "action_id", "user_id", "run", "exento", "first_names", "last_names", "company_id", "created_at"],
    orderBy: ID_ASC,
  },
  {
    name: "lesson_progress",
    table: "lesson_progress",
    columns: ["id", "tenant_id", "enrollment_id", "lesson_id", "completed", "completed_at", "updated_at"],
    orderBy: ID_ASC,
  },
  {
    name: "grades",
    table: "grades",
    columns: [
      "id", "tenant_id", "enrollment_id", "source_kind", "quiz_id", "assignment_id",
      "submission_id", "score", "max_score", "grade", "feedback", "rubric_scores",
      "status", "graded_by", "published_by", "published_at", "created_at", "updated_at",
    ],
    orderBy: ID_ASC,
  },
  {
    name: "quizzes",
    table: "quizzes",
    columns: [
      "id", "tenant_id", "course_id", "title", "description", "status", "time_limit_minutes",
      "max_attempts", "attempt_scoring", "passing_pct", "pool_size", "shuffle_questions",
      "shuffle_choices", "review_policy", "opens_at", "closes_at", "weight", "created_at", "updated_at",
    ],
    orderBy: ID_ASC,
  },
  {
    name: "quiz_attempts",
    table: "quiz_attempts",
    columns: [
      "id", "tenant_id", "quiz_id", "enrollment_id", "attempt_number", "status",
      "questions_snapshot", "answer_key", "answers", "score", "max_score", "grade",
      "started_at", "expires_at", "submitted_at", "updated_at",
    ],
    orderBy: ID_ASC,
  },
  {
    name: "assignments",
    table: "assignments",
    columns: [
      "id", "tenant_id", "course_id", "title", "instructions", "status", "due_at",
      "grace_hours", "rubric", "passing_pct", "weight", "created_at", "updated_at",
    ],
    orderBy: ID_ASC,
  },
  {
    // Metadatos SOLO: el binario de la entrega no va en el CSV/JSON (viaja
    // aparte, como archivo del ZIP, bajo presupuesto).
    name: "submissions",
    table: "submissions",
    columns: [
      "id", "tenant_id", "assignment_id", "enrollment_id", "version", "comment",
      "file_path", "file_name", "file_size", "mime_type", "late", "submitted_at",
    ],
    orderBy: ID_ASC,
  },
  {
    name: "sence_sessions",
    table: "sence_sessions",
    columns: [
      "id", "tenant_id", "enrollment_id", "sence_course_code", "action_code", "training_line",
      "run_alumno", "id_sesion_alumno", "id_sesion_sence", "status", "environment",
      "opened_at", "closed_at", "zona_horaria", "expires_at", "error_codes", "error_origin",
      "created_at", "updated_at",
    ],
    orderBy: ID_ASC,
  },
  {
    name: "sence_events",
    table: "sence_events",
    columns: ["id", "tenant_id", "session_id", "kind", "payload", "glosa_error_raw", "error_codes", "late", "dedupe_hash", "received_at"],
    orderBy: ID_ASC,
  },
  {
    name: "certificates",
    table: "certificates",
    columns: [
      "id", "tenant_id", "enrollment_id", "action_id", "course_id", "folio", "verification_token",
      "status", "is_sence", "snapshot", "pdf_path", "issued_by", "issued_at",
      "revoked_reason", "revoked_by", "revoked_at", "expires_at", "updated_at",
    ],
    orderBy: ID_ASC,
  },
  {
    // PK = tenant_id (una fila por tenant): no hay columna `id`.
    name: "certificate_expiry_config",
    table: "certificate_expiry_config",
    columns: ["tenant_id", "offsets_days", "enabled", "updated_by", "updated_at"],
    orderBy: [{ column: "tenant_id", ascending: true }],
  },
  {
    name: "certificate_expiry_alerts",
    table: "certificate_expiry_alerts",
    columns: ["id", "tenant_id", "certificate_id", "offset_days", "sent_at"],
    orderBy: ID_ASC,
  },
  {
    name: "alerts",
    table: "alerts",
    columns: ["id", "tenant_id", "kind", "severity", "message", "details", "action_id", "created_at", "acknowledged_at", "acknowledged_by"],
    orderBy: ID_ASC,
  },
  {
    name: "announcements",
    table: "announcements",
    columns: ["id", "tenant_id", "course_id", "action_id", "author_user_id", "title", "body", "status", "published_at", "created_at", "updated_at"],
    orderBy: ID_ASC,
  },
  {
    name: "forum_threads",
    table: "forum_threads",
    columns: ["id", "tenant_id", "course_id", "author_user_id", "title", "resolved", "resolved_by", "resolved_at", "created_at", "updated_at"],
    orderBy: ID_ASC,
  },
  {
    name: "forum_posts",
    table: "forum_posts",
    columns: ["id", "tenant_id", "thread_id", "author_user_id", "from_staff", "body", "created_at"],
    orderBy: ID_ASC,
  },
  {
    name: "message_threads",
    table: "message_threads",
    columns: ["id", "tenant_id", "course_id", "student_user_id", "subject", "last_message_at", "created_at"],
    orderBy: ID_ASC,
  },
  {
    name: "messages",
    table: "messages",
    columns: ["id", "tenant_id", "thread_id", "sender_user_id", "sender_is_staff", "body", "read_at", "created_at"],
    orderBy: ID_ASC,
  },
  {
    name: "notifications",
    table: "notifications",
    columns: ["id", "tenant_id", "user_id", "kind", "payload", "status", "created_at"],
    orderBy: ID_ASC,
  },
  {
    name: "consents",
    table: "consents",
    columns: ["id", "tenant_id", "user_id", "policy_version", "accepted_at", "ip"],
    orderBy: ID_ASC,
  },
  {
    // Metadatos SOLO: el binario del documento va aparte en el ZIP.
    name: "action_documents",
    table: "action_documents",
    columns: [
      "id", "tenant_id", "action_id", "doc_type", "title", "status", "is_definitive",
      "document_date", "file_path", "file_name", "file_size", "mime_type", "uploaded_by",
      "created_at", "updated_at",
    ],
    orderBy: ID_ASC,
  },
  {
    name: "companies",
    table: "companies",
    columns: ["id", "tenant_id", "rut", "razon_social", "created_by", "created_at", "updated_at"],
    orderBy: ID_ASC,
  },
  {
    name: "company_members",
    table: "company_members",
    columns: ["id", "tenant_id", "company_id", "user_id", "email", "revoked_at", "revoked_by", "created_by", "created_at"],
    orderBy: ID_ASC,
  },
  {
    name: "supervisor_grants",
    table: "supervisor_grants",
    columns: ["id", "tenant_id", "user_id", "email", "scope", "expires_at", "revoked_at", "revoked_by", "created_by", "created_at", "updated_at"],
    orderBy: ID_ASC,
  },
  {
    name: "automation_config",
    table: "automation_config",
    columns: ["id", "tenant_id", "action_id", "kind", "enabled", "settings", "updated_by", "created_at", "updated_at"],
    orderBy: ID_ASC,
  },
  {
    name: "communication_opt_outs",
    table: "communication_opt_outs",
    columns: ["id", "tenant_id", "user_id", "channel", "created_at"],
    orderBy: ID_ASC,
  },
  {
    name: "audit_log",
    table: "audit_log",
    columns: ["id", "tenant_id", "actor_user_id", "action", "entity", "entity_id", "ip", "details", "created_at"],
    orderBy: ID_ASC,
  },
];

/** true si el registro tiene nombres de dataset únicos (invariante, cubierto por test). */
export function hasUniqueDatasetNames(entries: readonly ExportDatasetEntry[] = EXPORT_DATASETS): boolean {
  return new Set(entries.map((e) => e.name)).size === entries.length;
}

// ---------- serialización ----------

/** Stringifica una celda de forma genérica (sin conocer el tipo de columna). */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  // jsonb (objetos/arrays) y arrays de Postgres (roles, error_codes, offsets_days).
  return JSON.stringify(value);
}

/**
 * CSV de un dataset. REUSA `toCsv` de `cumplimiento.ts` (ya neutraliza inyección
 * de fórmulas, CWE-1236, y separa con `;` + BOM para Excel es-CL): no se
 * reimplementa el escape.
 */
export function datasetToCsv(columns: readonly string[], rows: readonly Record<string, unknown>[]): string {
  const table = rows.map((row) => columns.map((c) => cellToString(row[c])));
  return toCsv(columns, table);
}

/** JSON legible por máquina (y por humanos: pretty) de un dataset. */
export function datasetToJson(rows: readonly Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2);
}

// ---------- presupuesto de tamaño ----------

export const DEFAULT_MAX_EXPORT_BYTES = 300 * 1024 * 1024; // 300 MB

export interface OmittedFile {
  readonly name: string;
  readonly reason: string;
}

/**
 * Presupuesto de tamaño del ZIP. `tryAdd` es el ÚNICO camino para admitir un
 * archivo: si no cabe, lo registra en `omitted` con motivo y devuelve false.
 * Ningún archivo se omite en silencio (CA): todo lo que no entra queda en el
 * manifiesto. `recordOmitted` es para omisiones que no son de presupuesto
 * (p.ej. un archivo de Storage que ya no existe) — incluso esas pasan por el
 * MISMO objeto, así el manifiesto tiene una sola fuente de verdad.
 */
export class FileBudget {
  readonly maxBytes: number;
  private usedBytes = 0;
  private readonly omittedList: OmittedFile[] = [];

  constructor(maxBytes: number = DEFAULT_MAX_EXPORT_BYTES) {
    this.maxBytes = maxBytes;
  }

  tryAdd(name: string, size: number): boolean {
    if (this.usedBytes + size > this.maxBytes) {
      this.omittedList.push({ name, reason: `excede el presupuesto del export (${this.maxBytes} bytes)` });
      return false;
    }
    this.usedBytes += size;
    return true;
  }

  recordOmitted(name: string, reason: string): void {
    this.omittedList.push({ name, reason });
  }

  get used(): number {
    return this.usedBytes;
  }

  get omitted(): readonly OmittedFile[] {
    return this.omittedList;
  }
}

// ---------- manifiesto ----------

const MANIFEST_SCHEMA_VERSION = 1;

export interface ManifestFile {
  readonly name: string;
  readonly bytes: number;
}

export interface ManifestInput {
  readonly tenantSlug: string;
  readonly generatedAt: string;
  /** dataset → cantidad de filas exportadas (incluye los de 0 filas). */
  readonly datasets: Readonly<Record<string, number>>;
  readonly files: {
    readonly included: readonly ManifestFile[];
    readonly omitted: readonly OmittedFile[];
  };
}

export interface Manifest extends ManifestInput {
  readonly schemaVersion: number;
  readonly totalBytes: number;
}

export function buildManifest(input: ManifestInput): Manifest {
  const totalBytes = input.files.included.reduce((sum, f) => sum + f.bytes, 0);
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, totalBytes, ...input };
}
