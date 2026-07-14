/**
 * SENCE error table as code — the single source of truth for translating RCE
 * `GlosaError` codes to what the student sees and to the system action taken.
 *
 * Frozen contract: `src/modules/sence/README.md` §5 (official glosas VERBATIM from
 * manual v1.1.6, Anexo 2 — deprecated codes from v1.1.3). Related invariants:
 *
 *  - I-5  `GlosaError` is always parsed as text and split by `;` (trim each token,
 *          drop empties). Non-numeric tokens are ignored but surfaced in a typed
 *          field (`invalidTokens`) so protocol drift is never silently swallowed.
 *  - I-9  Translation is TOTAL: every received code maps to a message. Unknown and
 *          deprecated codes resolve to the generic fallback. The raw code, the
 *          official glosa and any technical text are NEVER shown to the student.
 *
 * Student-facing strings live ONLY in `src/i18n/es-CL.ts` under `sence.errors`;
 * this module references those keys (never inlines Spanish text).
 */
import { esCL } from "@/i18n/es-CL";

/** Keys of the student-facing message catalog (`esCL.sence.errors`). */
export type SenceMessageKey = keyof typeof esCL.sence.errors;

/**
 * Log level the backend should emit for a given error. Mirrors the contract's
 * "Acción del sistema" column: WARN for the fallback / recoverable path, ERROR
 * for our own integration bugs and critical OTEC/token misconfiguration.
 */
export enum SenceLogLevel {
  Warn = "warn",
  Error = "error",
}

/**
 * Operational severity, used to (a) drive alerting and (b) pick the dominant code
 * when a `GlosaError` carries several codes (see {@link resolveGlosaError}).
 * Ordered from least to most urgent by {@link SEVERITY_RANK}.
 */
export enum SenceErrorSeverity {
  /** New/unrecognized or deprecated code — protocol drift, needs team review. */
  Unknown = "unknown",
  /** Normal, expected: the student can retry on their own. */
  StudentRecoverable = "student_recoverable",
  /** Transient problem on SENCE's side: register/escalate, retry allowed. */
  SenceSide = "sence_side",
  /** Action/tenant/token configuration problem: tenant admin must intervene. */
  TenantConfig = "tenant_config",
  /** Our own integration bug: alert the dev team; should not reach production. */
  IntegrationBug = "integration_bug",
}

/**
 * Downstream system actions modeled from the contract's "Acción del sistema"
 * column. An entry may carry several; {@link resolveGlosaError} unions them so no
 * action is dropped when multiple codes arrive.
 */
export enum SenceErrorAction {
  /** The student may retry on their own (new session, T1). */
  RetryAllowed = "retry_allowed",
  /** Block new start attempts for this action until it is fixed. */
  BlockAction = "block_action",
  /** Alert the tenant admin (action/tenant/token configuration). */
  AlertTenantAdmin = "alert_tenant_admin",
  /** Alert the dev team (integration bug or unknown code). */
  AlertTeam = "alert_team",
  /** Escalate to SENCE attaching the `sence_events` (never the token, I-6). */
  EscalateToSence = "escalate_to_sence",
  /** Flag the student profile for data correction (RUN). */
  MarkStudentProfile = "mark_student_profile",
  /** Flag the action as misconfigured before SENCE. */
  MarkActionMisconfigured = "mark_action_misconfigured",
  /** Record the event in `audit_log` (possible impersonation). */
  AuditLog = "audit_log",
  /** Treat as an unknown code (deprecated): fallback + alert. */
  TreatAsUnknown = "treat_as_unknown",
  /** Do NOT retry automatically (our own bug). */
  NoAutoRetry = "no_auto_retry",
  /** Enable a session-close retry (T8). */
  EnableCloseRetry = "enable_close_retry",
}

/** A single row of the frozen error table (§5). */
export interface SenceErrorEntry {
  /** Numeric SENCE code (100–313). */
  readonly code: number;
  /** Official glosa, copied VERBATIM from the manual — for logs/audit ONLY. */
  readonly officialGlosa: string;
  /** Key into `esCL.sence.errors` for the student-facing message. */
  readonly messageKey: SenceMessageKey;
  readonly severity: SenceErrorSeverity;
  readonly logLevel: SenceLogLevel;
  readonly actions: readonly SenceErrorAction[];
  /**
   * `true` for codes removed from the manual (100, 210 — v1.1.3 only). Kept as
   * entries that resolve to the fallback (I-9); the mock never emits them.
   */
  readonly deprecated: boolean;
}

/**
 * The frozen error table (§5), keyed by numeric code. Because the key type is a
 * numeric index signature, `noUncheckedIndexedAccess` correctly types lookups as
 * `SenceErrorEntry | undefined` — the basis for the total translation (I-9).
 */
export const SENCE_ERROR_TABLE: Readonly<Record<number, SenceErrorEntry>> = {
  // --- DEPRECATED (v1.1.3 only; resolve to fallback, mock never emits) ---------
  100: {
    code: 100,
    officialGlosa: "Contraseña incorrecta o el usuario no tiene Clave SENCE.",
    messageKey: "fallback",
    severity: SenceErrorSeverity.Unknown,
    logLevel: SenceLogLevel.Warn,
    actions: [SenceErrorAction.TreatAsUnknown, SenceErrorAction.AlertTeam],
    deprecated: true,
  },
  210: {
    code: 210,
    officialGlosa:
      "Expiró el tiempo disponible para el ingreso de RUT y Contraseña. El tiempo disponible es de tres minutos.",
    messageKey: "fallback",
    severity: SenceErrorSeverity.Unknown,
    logLevel: SenceLogLevel.Warn,
    actions: [SenceErrorAction.TreatAsUnknown, SenceErrorAction.AlertTeam],
    deprecated: true,
  },

  // --- 200 series --------------------------------------------------------------
  200: {
    code: 200,
    officialGlosa:
      "El POST tiene uno o más parámetros mandatorios sin información. Esto también ocurre cuando un parámetro está mal escrito (por ejemplo, RutAlumno en lugar de RunAlumno), o cuando se ingresan sólo espacios en blanco en un parámetro obligatorio.",
    messageKey: "technicalIssue",
    severity: SenceErrorSeverity.IntegrationBug,
    logLevel: SenceLogLevel.Error,
    actions: [SenceErrorAction.AlertTeam, SenceErrorAction.NoAutoRetry],
    deprecated: false,
  },
  201: {
    code: 201,
    officialGlosa:
      "La URL de Retoma y/o URL de Error no tienen información. Ambos parámetros son obligatorios en todos los POST.",
    messageKey: "technicalIssue",
    severity: SenceErrorSeverity.IntegrationBug,
    logLevel: SenceLogLevel.Error,
    actions: [SenceErrorAction.AlertTeam],
    deprecated: false,
  },
  202: {
    code: 202,
    officialGlosa: "La URL de Retoma tiene formato incorrecto.",
    messageKey: "technicalIssue",
    severity: SenceErrorSeverity.IntegrationBug,
    logLevel: SenceLogLevel.Error,
    actions: [SenceErrorAction.AlertTenantAdmin, SenceErrorAction.AlertTeam],
    deprecated: false,
  },
  203: {
    code: 203,
    officialGlosa: "La URL de Error tiene formato incorrecto.",
    messageKey: "technicalIssue",
    severity: SenceErrorSeverity.IntegrationBug,
    logLevel: SenceLogLevel.Error,
    actions: [SenceErrorAction.AlertTenantAdmin, SenceErrorAction.AlertTeam],
    deprecated: false,
  },
  204: {
    code: 204,
    officialGlosa:
      "El Código SENCE tiene menos de 10 caracteres y/o no es código válido.",
    messageKey: "courseMisconfigured",
    severity: SenceErrorSeverity.TenantConfig,
    logLevel: SenceLogLevel.Warn,
    actions: [
      SenceErrorAction.MarkActionMisconfigured,
      SenceErrorAction.AlertTenantAdmin,
    ],
    deprecated: false,
  },
  205: {
    code: 205,
    officialGlosa:
      "El Código Curso tiene menos de 7 caracteres y/o no es código válido.",
    messageKey: "courseMisconfigured",
    severity: SenceErrorSeverity.TenantConfig,
    logLevel: SenceLogLevel.Warn,
    actions: [
      SenceErrorAction.MarkActionMisconfigured,
      SenceErrorAction.AlertTenantAdmin,
    ],
    deprecated: false,
  },
  206: {
    code: 206,
    officialGlosa: "La línea de capacitación es incorrecta.",
    messageKey: "courseMisconfigured",
    severity: SenceErrorSeverity.TenantConfig,
    logLevel: SenceLogLevel.Warn,
    actions: [SenceErrorAction.AlertTenantAdmin],
    deprecated: false,
  },
  207: {
    code: 207,
    officialGlosa:
      "El Run Alumno tiene formato incorrecto, o tiene el dígito verificador incorrecto.",
    messageKey: "invalidStudentRun",
    severity: SenceErrorSeverity.IntegrationBug,
    logLevel: SenceLogLevel.Error,
    actions: [SenceErrorAction.AlertTeam, SenceErrorAction.MarkStudentProfile],
    deprecated: false,
  },
  208: {
    code: 208,
    officialGlosa: "El Run Alumno no está autorizado para realizar el curso.",
    messageKey: "studentNotEnrolled",
    severity: SenceErrorSeverity.TenantConfig,
    logLevel: SenceLogLevel.Warn,
    actions: [SenceErrorAction.AlertTenantAdmin],
    deprecated: false,
  },
  209: {
    code: 209,
    officialGlosa:
      "El Rut OTEC tiene formato incorrecto, o tiene el dígito verificador incorrecto.",
    messageKey: "technicalIssue",
    severity: SenceErrorSeverity.IntegrationBug,
    logLevel: SenceLogLevel.Error,
    actions: [SenceErrorAction.AlertTeam, SenceErrorAction.AlertTenantAdmin],
    deprecated: false,
  },
  211: {
    code: 211,
    officialGlosa: "El Token no pertenece al OTEC.",
    messageKey: "tokenIssue",
    severity: SenceErrorSeverity.TenantConfig,
    logLevel: SenceLogLevel.Error,
    actions: [SenceErrorAction.AlertTenantAdmin],
    deprecated: false,
  },
  212: {
    code: 212,
    officialGlosa: "El Token no está vigente.",
    messageKey: "tokenIssue",
    severity: SenceErrorSeverity.TenantConfig,
    logLevel: SenceLogLevel.Error,
    actions: [SenceErrorAction.AlertTenantAdmin],
    deprecated: false,
  },

  // --- 300 series --------------------------------------------------------------
  300: {
    code: 300,
    officialGlosa:
      "Error interno no clasificado, se debe reportar al SENCE con la mayor cantidad de antecedentes disponibles.",
    messageKey: "senceTemporaryIssue",
    severity: SenceErrorSeverity.SenceSide,
    logLevel: SenceLogLevel.Warn,
    actions: [SenceErrorAction.RetryAllowed, SenceErrorAction.EscalateToSence],
    deprecated: false,
  },
  301: {
    code: 301,
    officialGlosa:
      "No se pudo registrar el ingreso o cierre de sesión. Esto ocurre cuando la Línea de Capacitación es incorrecta, o el Código de Curso es incorrecto.",
    messageKey: "sessionNotRegistered",
    severity: SenceErrorSeverity.TenantConfig,
    logLevel: SenceLogLevel.Warn,
    actions: [SenceErrorAction.AlertTenantAdmin, SenceErrorAction.RetryAllowed],
    deprecated: false,
  },
  302: {
    code: 302,
    officialGlosa:
      "No se pudo validar la información del Organismo, se debe reportar al SENCE con la mayor cantidad de antecedentes disponibles.",
    messageKey: "organismValidationIssue",
    severity: SenceErrorSeverity.SenceSide,
    logLevel: SenceLogLevel.Warn,
    actions: [SenceErrorAction.EscalateToSence, SenceErrorAction.AlertTeam],
    deprecated: false,
  },
  303: {
    code: 303,
    officialGlosa: "El Token no existe, o su formato es incorrecto.",
    messageKey: "tokenIssue",
    severity: SenceErrorSeverity.TenantConfig,
    logLevel: SenceLogLevel.Error,
    actions: [SenceErrorAction.AlertTenantAdmin],
    deprecated: false,
  },
  304: {
    code: 304,
    officialGlosa:
      "No se pudieron verificar los datos enviados, se debe reportar al SENCE con la mayor cantidad de antecedentes disponibles (ej. enviar parámetros de inicio o cierre de sesión según corresponda)",
    messageKey: "senceTemporaryIssue",
    severity: SenceErrorSeverity.SenceSide,
    logLevel: SenceLogLevel.Warn,
    actions: [SenceErrorAction.RetryAllowed, SenceErrorAction.EscalateToSence],
    deprecated: false,
  },
  305: {
    code: 305,
    officialGlosa:
      "No se pudo registrar la información, se debe reportar al SENCE con la mayor cantidad de antecedentes disponibles. (ej. enviar parámetros de inicio o cierre de sesión según corresponda)",
    messageKey: "senceTemporaryIssue",
    severity: SenceErrorSeverity.SenceSide,
    logLevel: SenceLogLevel.Warn,
    actions: [SenceErrorAction.RetryAllowed, SenceErrorAction.EscalateToSence],
    deprecated: false,
  },
  306: {
    code: 306,
    officialGlosa: "El Código Curso no corresponde al código SENCE.",
    messageKey: "courseMisconfigured",
    severity: SenceErrorSeverity.TenantConfig,
    logLevel: SenceLogLevel.Warn,
    actions: [SenceErrorAction.AlertTenantAdmin],
    deprecated: false,
  },
  307: {
    code: 307,
    officialGlosa: "El Código Curso no tiene modalidad E-learning.",
    messageKey: "courseNotElearning",
    severity: SenceErrorSeverity.TenantConfig,
    logLevel: SenceLogLevel.Warn,
    actions: [SenceErrorAction.AlertTenantAdmin, SenceErrorAction.BlockAction],
    deprecated: false,
  },
  308: {
    code: 308,
    // NOTE: no final period in the original — do not "fix" (§5 note).
    officialGlosa: "El Código Curso no corresponde al RUT OTEC",
    messageKey: "courseMisconfigured",
    severity: SenceErrorSeverity.TenantConfig,
    logLevel: SenceLogLevel.Warn,
    actions: [SenceErrorAction.AlertTenantAdmin],
    deprecated: false,
  },
  309: {
    code: 309,
    officialGlosa:
      "Las fechas de ejecución comunicadas para el Código Curso no corresponden a la fecha actual.",
    messageKey: "courseOutsideExecutionDates",
    severity: SenceErrorSeverity.TenantConfig,
    logLevel: SenceLogLevel.Warn,
    actions: [SenceErrorAction.BlockAction, SenceErrorAction.AlertTenantAdmin],
    deprecated: false,
  },
  310: {
    code: 310,
    officialGlosa: "El Código Curso está en estado Terminado o Anulado.",
    messageKey: "courseFinishedOrCancelled",
    severity: SenceErrorSeverity.TenantConfig,
    logLevel: SenceLogLevel.Warn,
    actions: [SenceErrorAction.BlockAction, SenceErrorAction.AlertTenantAdmin],
    deprecated: false,
  },
  311: {
    code: 311,
    officialGlosa:
      "Run ingresado en el Login de Clave Única no corresponde con Run alumno informado por el ejecutor.",
    messageKey: "claveUnicaRunMismatch",
    severity: SenceErrorSeverity.StudentRecoverable,
    logLevel: SenceLogLevel.Warn,
    actions: [SenceErrorAction.RetryAllowed, SenceErrorAction.AuditLog],
    deprecated: false,
  },
  312: {
    code: 312,
    officialGlosa: "No se pudo completar la autenticación con Clave Única.",
    messageKey: "claveUnicaAuthFailed",
    severity: SenceErrorSeverity.StudentRecoverable,
    logLevel: SenceLogLevel.Warn,
    actions: [SenceErrorAction.RetryAllowed],
    deprecated: false,
  },
  313: {
    code: 313,
    // NOTE: "Incorrecta" is capitalized in the original — do not "fix" (§5 note).
    officialGlosa: "URL de Cierre de sesión Incorrecta.",
    messageKey: "sessionCloseFailed",
    severity: SenceErrorSeverity.IntegrationBug,
    logLevel: SenceLogLevel.Error,
    actions: [SenceErrorAction.AlertTeam, SenceErrorAction.EnableCloseRetry],
    deprecated: false,
  },
};

/** Codes the mock may emit (all non-deprecated codes: 200–212 without 210, 300–313). */
export const ACTIVE_SENCE_ERROR_CODES: readonly number[] = Object.values(
  SENCE_ERROR_TABLE,
)
  .filter((e) => !e.deprecated)
  .map((e) => e.code)
  .sort((a, b) => a - b);

/** Deprecated codes kept only as fallback-resolving entries (100, 210). */
export const DEPRECATED_SENCE_ERROR_CODES: readonly number[] = Object.values(
  SENCE_ERROR_TABLE,
)
  .filter((e) => e.deprecated)
  .map((e) => e.code)
  .sort((a, b) => a - b);

/** Every code present in the table (active + deprecated). */
export const ALL_SENCE_ERROR_CODES: readonly number[] = Object.values(
  SENCE_ERROR_TABLE,
)
  .map((e) => e.code)
  .sort((a, b) => a - b);

/** Least → most urgent. Higher wins the dominant slot in {@link resolveGlosaError}. */
const SEVERITY_RANK: Record<SenceErrorSeverity, number> = {
  [SenceErrorSeverity.Unknown]: 0,
  [SenceErrorSeverity.StudentRecoverable]: 1,
  [SenceErrorSeverity.SenceSide]: 2,
  [SenceErrorSeverity.TenantConfig]: 3,
  [SenceErrorSeverity.IntegrationBug]: 4,
};

/** Raw table lookup. Returns `undefined` for codes not in the table. */
export function getSenceErrorEntry(code: number): SenceErrorEntry | undefined {
  return SENCE_ERROR_TABLE[code];
}

// ---------------------------------------------------------------------------
// I-5 — parsing `GlosaError` as a `;`-separated list of codes.
// ---------------------------------------------------------------------------

/**
 * Result of parsing a raw `GlosaError`. `invalidTokens` is the typed report of
 * non-numeric fragments: they are ignored for translation (I-5) but never
 * silently dropped — callers can log/alert on protocol drift.
 */
export interface ParsedGlosaError {
  readonly codes: number[];
  readonly invalidTokens: string[];
}

/** A token is a valid code iff it is a run of ASCII digits (e.g. `"211"`, `"0"`). */
const CODE_TOKEN = /^\d+$/;

/**
 * Parse a raw `GlosaError` (I-5): split by `;`, trim each token, drop empties,
 * keep numeric tokens as codes and collect the rest into `invalidTokens`.
 * Total and pure over ANY string — tolerates empty, garbage, only-separators and
 * huge/precision-losing numeric tokens (they resolve to an unknown code, never a
 * throw); it never throws.
 *
 * Boundary contract: `raw` is typed `string` on purpose (not `string | null`).
 * The callback edge validates the POST body with Zod and persists the raw
 * payload FIRST (I-1) before this pure domain function runs, so `null`/`undefined`
 * are rejected at compile time and cannot reach `raw.split` at runtime. Do not
 * widen the type to "guard" here — that would move a boundary concern into the
 * domain and hide a validation gap.
 */
export function parseGlosaErrorDetailed(raw: string): ParsedGlosaError {
  const codes: number[] = [];
  const invalidTokens: string[] = [];
  for (const part of raw.split(";")) {
    const token = part.trim();
    if (token.length === 0) continue; // discard empties
    if (CODE_TOKEN.test(token)) {
      codes.push(Number(token));
    } else {
      invalidTokens.push(token); // ignored for translation, but reported (typed)
    }
  }
  return { codes, invalidTokens };
}

/**
 * Parse a raw `GlosaError` into its numeric codes (I-5). Convenience projection
 * of {@link parseGlosaErrorDetailed} for callers that don't need the ignored
 * tokens. Returns `[]` for empty/garbage input.
 */
export function parseGlosaError(raw: string): number[] {
  return parseGlosaErrorDetailed(raw).codes;
}

// ---------------------------------------------------------------------------
// I-9 — TOTAL translation of a single code.
// ---------------------------------------------------------------------------

/**
 * The resolved translation of a single SENCE code. `studentMessage` is ALWAYS a
 * safe es-CL string (never the raw code or the official glosa). `officialGlosa`
 * is for internal logs/audit only and MUST NOT be shown to the student.
 */
export interface SenceErrorTranslation {
  /** The code that produced this translation (the input for unknown codes). */
  readonly code: number;
  /** `true` only for codes present in the table AND not deprecated. */
  readonly known: boolean;
  /** `true` for the deprecated codes 100 / 210. */
  readonly deprecated: boolean;
  /** es-CL message shown to the student. Never the raw code or the glosa. */
  readonly studentMessage: string;
  /** VERBATIM official glosa (internal use only); `null` for unknown codes. */
  readonly officialGlosa: string | null;
  readonly messageKey: SenceMessageKey;
  readonly severity: SenceErrorSeverity;
  readonly logLevel: SenceLogLevel;
  readonly actions: readonly SenceErrorAction[];
}

function unknownTranslation(code: number): SenceErrorTranslation {
  return {
    code,
    known: false,
    deprecated: false,
    studentMessage: esCL.sence.errors.fallback,
    officialGlosa: null,
    messageKey: "fallback",
    severity: SenceErrorSeverity.Unknown,
    logLevel: SenceLogLevel.Warn,
    actions: [SenceErrorAction.AlertTeam],
  };
}

/**
 * Translate a single SENCE code — TOTAL (I-9): every code returns a translation,
 * never throws, never returns `undefined`, and never surfaces the raw code as a
 * message. Known codes resolve to their table entry; unknown and deprecated
 * codes resolve to the generic fallback.
 */
export function translateSenceError(code: number): SenceErrorTranslation {
  const entry = getSenceErrorEntry(code);
  if (entry === undefined) {
    return unknownTranslation(code);
  }
  // Deprecated codes are treated as unknown for the student (fallback message,
  // via `messageKey: "fallback"`) but keep their table metadata for logs.
  return {
    code: entry.code,
    known: !entry.deprecated,
    deprecated: entry.deprecated,
    studentMessage: esCL.sence.errors[entry.messageKey],
    officialGlosa: entry.officialGlosa,
    messageKey: entry.messageKey,
    severity: entry.severity,
    logLevel: entry.logLevel,
    actions: entry.actions,
  };
}

// ---------------------------------------------------------------------------
// Full `GlosaError` resolution (multi-code) — student message + system action.
// ---------------------------------------------------------------------------

/**
 * The resolution of a full (possibly multi-code) `GlosaError`.
 *
 * Aggregation policy (documented and deterministic):
 *  - `codes` / `invalidTokens`: from {@link parseGlosaErrorDetailed} (I-5).
 *  - `perCode`: one {@link SenceErrorTranslation} per code, in order (I-9).
 *  - `studentMessage` / `dominantCode` / `severity`: the MOST SEVERE code wins
 *    (highest {@link SEVERITY_RANK}); ties are broken by first appearance in the
 *    raw string. Rationale: escalate to the most urgent problem, deterministically.
 *  - `actions`: the UNION of every code's actions (first-seen order, deduped) so
 *    no downstream action is lost when several codes arrive together.
 *  - `logLevel`: ERROR if any code is ERROR, else WARN.
 *  - Degenerate case (no parseable code — e.g. `""`, `"abc"`, `" ; ; "`, or an
 *    all-invalid glosa): resolves to the fallback with severity `Unknown` and an
 *    `AlertTeam` action, since a non-empty `GlosaError` (I-4) with no code is
 *    itself anomalous. `dominantCode` is `null`.
 *  - If any `invalidTokens` were ignored, `AlertTeam` is added (protocol drift).
 */
export interface SenceGlosaResolution {
  readonly rawGlosaError: string;
  readonly codes: number[];
  readonly invalidTokens: string[];
  readonly perCode: SenceErrorTranslation[];
  readonly studentMessage: string;
  readonly dominantCode: number | null;
  readonly severity: SenceErrorSeverity;
  readonly logLevel: SenceLogLevel;
  readonly actions: SenceErrorAction[];
}

/**
 * Resolve a full `GlosaError` to the single message shown to the student and the
 * aggregate system action. Total and pure. See {@link SenceGlosaResolution} for
 * the exact aggregation policy.
 */
export function resolveGlosaError(raw: string): SenceGlosaResolution {
  const { codes, invalidTokens } = parseGlosaErrorDetailed(raw);
  const perCode = codes.map(translateSenceError);

  // Union of actions, first-seen order, deduped.
  const actions: SenceErrorAction[] = [];
  for (const translation of perCode) {
    for (const action of translation.actions) {
      if (!actions.includes(action)) actions.push(action);
    }
  }
  const alertTeamForDrift =
    invalidTokens.length > 0 && !actions.includes(SenceErrorAction.AlertTeam);
  if (alertTeamForDrift) actions.push(SenceErrorAction.AlertTeam);

  const [first, ...rest] = perCode;
  if (first === undefined) {
    // Degenerate: non-empty GlosaError (I-4) but nothing parseable.
    if (!actions.includes(SenceErrorAction.AlertTeam)) {
      actions.push(SenceErrorAction.AlertTeam);
    }
    return {
      rawGlosaError: raw,
      codes,
      invalidTokens,
      perCode,
      studentMessage: esCL.sence.errors.fallback,
      dominantCode: null,
      severity: SenceErrorSeverity.Unknown,
      logLevel: SenceLogLevel.Warn,
      actions,
    };
  }

  let dominant = first;
  for (const translation of rest) {
    if (SEVERITY_RANK[translation.severity] > SEVERITY_RANK[dominant.severity]) {
      dominant = translation;
    }
  }

  const logLevel = perCode.some((t) => t.logLevel === SenceLogLevel.Error)
    ? SenceLogLevel.Error
    : SenceLogLevel.Warn;

  return {
    rawGlosaError: raw,
    codes,
    invalidTokens,
    perCode,
    studentMessage: dominant.studentMessage,
    dominantCode: dominant.code,
    severity: dominant.severity,
    logLevel,
    actions,
  };
}
