/**
 * Unit tests for the SENCE error table (pure domain, no IO).
 * Derived LITERALLY from the frozen contract §5 (glosas VERBATIM), I-5 and I-9.
 */
import { describe, expect, it } from "vitest";

import { esCL } from "@/i18n/es-CL";

import {
  ACTIVE_SENCE_ERROR_CODES,
  ALL_SENCE_ERROR_CODES,
  DEPRECATED_SENCE_ERROR_CODES,
  SENCE_ERROR_TABLE,
  SenceErrorAction,
  SenceErrorSeverity,
  SenceLogLevel,
  getSenceErrorEntry,
  parseGlosaError,
  parseGlosaErrorDetailed,
  resolveGlosaError,
  translateSenceError,
} from "./errors";
import type { SenceMessageKey } from "./errors";

/**
 * Glosas copied INDEPENDENTLY from contract §5 so the test truly verifies the
 * table is verbatim (including the 308 quirk — no final period — and the 313
 * quirk — "Incorrecta" capitalized). Do NOT reuse the table's own strings here.
 */
const EXPECTED_GLOSAS: ReadonlyMap<number, string> = new Map([
  [
    100,
    "Contraseña incorrecta o el usuario no tiene Clave SENCE.",
  ],
  [
    200,
    "El POST tiene uno o más parámetros mandatorios sin información. Esto también ocurre cuando un parámetro está mal escrito (por ejemplo, RutAlumno en lugar de RunAlumno), o cuando se ingresan sólo espacios en blanco en un parámetro obligatorio.",
  ],
  [
    201,
    "La URL de Retoma y/o URL de Error no tienen información. Ambos parámetros son obligatorios en todos los POST.",
  ],
  [202, "La URL de Retoma tiene formato incorrecto."],
  [203, "La URL de Error tiene formato incorrecto."],
  [204, "El Código SENCE tiene menos de 10 caracteres y/o no es código válido."],
  [205, "El Código Curso tiene menos de 7 caracteres y/o no es código válido."],
  [206, "La línea de capacitación es incorrecta."],
  [
    207,
    "El Run Alumno tiene formato incorrecto, o tiene el dígito verificador incorrecto.",
  ],
  [208, "El Run Alumno no está autorizado para realizar el curso."],
  [
    209,
    "El Rut OTEC tiene formato incorrecto, o tiene el dígito verificador incorrecto.",
  ],
  [
    210,
    "Expiró el tiempo disponible para el ingreso de RUT y Contraseña. El tiempo disponible es de tres minutos.",
  ],
  [211, "El Token no pertenece al OTEC."],
  [212, "El Token no está vigente."],
  [
    300,
    "Error interno no clasificado, se debe reportar al SENCE con la mayor cantidad de antecedentes disponibles.",
  ],
  [
    301,
    "No se pudo registrar el ingreso o cierre de sesión. Esto ocurre cuando la Línea de Capacitación es incorrecta, o el Código de Curso es incorrecto.",
  ],
  [
    302,
    "No se pudo validar la información del Organismo, se debe reportar al SENCE con la mayor cantidad de antecedentes disponibles.",
  ],
  [303, "El Token no existe, o su formato es incorrecto."],
  [
    304,
    "No se pudieron verificar los datos enviados, se debe reportar al SENCE con la mayor cantidad de antecedentes disponibles (ej. enviar parámetros de inicio o cierre de sesión según corresponda)",
  ],
  [
    305,
    "No se pudo registrar la información, se debe reportar al SENCE con la mayor cantidad de antecedentes disponibles. (ej. enviar parámetros de inicio o cierre de sesión según corresponda)",
  ],
  [306, "El Código Curso no corresponde al código SENCE."],
  [307, "El Código Curso no tiene modalidad E-learning."],
  // 308: no final period in the original.
  [308, "El Código Curso no corresponde al RUT OTEC"],
  [
    309,
    "Las fechas de ejecución comunicadas para el Código Curso no corresponden a la fecha actual.",
  ],
  [310, "El Código Curso está en estado Terminado o Anulado."],
  [
    311,
    "Run ingresado en el Login de Clave Única no corresponde con Run alumno informado por el ejecutor.",
  ],
  [312, "No se pudo completar la autenticación con Clave Única."],
  // 313: "Incorrecta" capitalized in the original.
  [313, "URL de Cierre de sesión Incorrecta."],
]);

const ACTIVE_CODES = [
  200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 211, 212, 300, 301, 302,
  303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313,
];
const DEPRECATED_CODES = [100, 210];

/**
 * The literal es-CL student messages, transcribed INDEPENDENTLY from contract §5
 * (column "Mensaje es-CL para el alumno"). Do NOT import these from `es-CL.ts` or
 * derive them from the table — the whole point is to pin the frozen text from an
 * independent source, exactly like {@link EXPECTED_GLOSAS} pins the glosas.
 */
const MSG = {
  fallback:
    "No pudimos registrar tu asistencia en SENCE. Intenta nuevamente; si el problema continúa, avisa a tu OTEC.",
  technicalIssue:
    "Hubo un problema técnico al conectar con SENCE. Ya avisamos al equipo; intenta más tarde.",
  courseMisconfigured:
    "El curso tiene un problema de configuración con SENCE. Avisa al administrador de tu curso.",
  invalidStudentRun:
    "Tu RUN registrado en la plataforma parece incorrecto. Pide a tu OTEC que lo corrija antes de reintentar.",
  studentNotEnrolled:
    "Tu RUN no aparece inscrito ante SENCE para este curso. Contacta a tu OTEC para verificar tu inscripción.",
  tokenIssue:
    "No pudimos validar la conexión con SENCE. Avisa al administrador de tu curso e intenta más tarde.",
  senceTemporaryIssue:
    "SENCE presentó un problema temporal. Intenta nuevamente en unos minutos.",
  sessionNotRegistered:
    "No se pudo registrar tu sesión en SENCE. Avisa al administrador de tu curso.",
  organismValidationIssue:
    "SENCE presentó un problema al validar los datos del organismo. Intenta más tarde.",
  courseNotElearning:
    "Este curso no está habilitado como e-learning ante SENCE. Avisa al administrador de tu curso.",
  courseOutsideExecutionDates:
    "El curso no está en su período de ejecución ante SENCE, por lo que hoy no se puede registrar asistencia. Consulta a tu OTEC.",
  courseFinishedOrCancelled:
    "Este curso figura terminado o anulado ante SENCE. Consulta a tu OTEC.",
  claveUnicaRunMismatch:
    "Iniciaste sesión en Clave Única con un RUN distinto al tuyo inscrito en el curso. Ingresa con TU propia Clave Única e intenta de nuevo.",
  claveUnicaAuthFailed:
    "No pudimos validar tu identidad con Clave Única. Intenta nuevamente; si el problema continúa, recupera tu Clave Única en claveunica.gob.cl.",
  sessionCloseFailed:
    "Hubo un problema técnico al cerrar tu sesión SENCE. Ya avisamos al equipo; intenta cerrar nuevamente.",
} as const;

/**
 * Expected message KEY per code, transcribed INDEPENDENTLY from §5. This is the
 * anchor that makes the translation test non-circular: it never reads
 * `SENCE_ERROR_TABLE`, so a flipped `messageKey` in the table (e.g. 207 →
 * `technicalIssue`, 208 → `technicalIssue`, 313 → `fallback`) fails here instead
 * of passing silently. Covers every code (active + the two deprecated).
 */
const EXPECTED_MESSAGE_KEYS: ReadonlyMap<number, SenceMessageKey> = new Map([
  [100, "fallback"],
  [200, "technicalIssue"],
  [201, "technicalIssue"],
  [202, "technicalIssue"],
  [203, "technicalIssue"],
  [204, "courseMisconfigured"],
  [205, "courseMisconfigured"],
  [206, "courseMisconfigured"],
  [207, "invalidStudentRun"],
  [208, "studentNotEnrolled"],
  [209, "technicalIssue"],
  [210, "fallback"],
  [211, "tokenIssue"],
  [212, "tokenIssue"],
  [300, "senceTemporaryIssue"],
  [301, "sessionNotRegistered"],
  [302, "organismValidationIssue"],
  [303, "tokenIssue"],
  [304, "senceTemporaryIssue"],
  [305, "senceTemporaryIssue"],
  [306, "courseMisconfigured"],
  [307, "courseNotElearning"],
  [308, "courseMisconfigured"],
  [309, "courseOutsideExecutionDates"],
  [310, "courseFinishedOrCancelled"],
  [311, "claveUnicaRunMismatch"],
  [312, "claveUnicaAuthFailed"],
  [313, "sessionCloseFailed"],
]);

/**
 * Expected literal es-CL message per ACTIVE code, transcribed INDEPENDENTLY from
 * §5 via {@link MSG}. Pinning the literal (not `esCL[key]`) also catches any drift
 * between `es-CL.ts` and §5, not just a flipped `messageKey`. Deprecated codes
 * (100/210) resolve to the fallback and are pinned via EXPECTED_MESSAGE_KEYS plus
 * the dedicated deprecated test.
 */
const EXPECTED_STUDENT_MESSAGES: ReadonlyMap<number, string> = new Map([
  [200, MSG.technicalIssue],
  [201, MSG.technicalIssue],
  [202, MSG.technicalIssue],
  [203, MSG.technicalIssue],
  [204, MSG.courseMisconfigured],
  [205, MSG.courseMisconfigured],
  [206, MSG.courseMisconfigured],
  [207, MSG.invalidStudentRun],
  [208, MSG.studentNotEnrolled],
  [209, MSG.technicalIssue],
  [211, MSG.tokenIssue],
  [212, MSG.tokenIssue],
  [300, MSG.senceTemporaryIssue],
  [301, MSG.sessionNotRegistered],
  [302, MSG.organismValidationIssue],
  [303, MSG.tokenIssue],
  [304, MSG.senceTemporaryIssue],
  [305, MSG.senceTemporaryIssue],
  [306, MSG.courseMisconfigured],
  [307, MSG.courseNotElearning],
  [308, MSG.courseMisconfigured],
  [309, MSG.courseOutsideExecutionDates],
  [310, MSG.courseFinishedOrCancelled],
  [311, MSG.claveUnicaRunMismatch],
  [312, MSG.claveUnicaAuthFailed],
  [313, MSG.sessionCloseFailed],
]);

/** Expected engine-modeling of §5's "Acción del sistema" column, per code. */
interface ExpectedSystemAction {
  readonly severity: SenceErrorSeverity;
  readonly logLevel: SenceLogLevel;
  readonly actions: readonly SenceErrorAction[];
}

/**
 * Expected `severity` / `logLevel` / `actions` per code, transcribed
 * INDEPENDENTLY from §5's "Acción del sistema" column. Unlike the glosas these
 * are an engine-modeling of the prose rather than frozen verbatim text, but
 * pinning them catches a mis-assigned severity/logLevel/action — which would
 * silently change dominant-code selection and alert routing in
 * {@link resolveGlosaError}. `actions` are compared as a SET (their order is not
 * contract-frozen). Covers every code (active + deprecated).
 */
const EXPECTED_SYSTEM_ACTIONS: ReadonlyMap<number, ExpectedSystemAction> =
  new Map([
    // Deprecated (v1.1.3): "Tratar como código desconocido (I-9): ... WARN + alerta".
    [
      100,
      {
        severity: SenceErrorSeverity.Unknown,
        logLevel: SenceLogLevel.Warn,
        actions: [SenceErrorAction.TreatAsUnknown, SenceErrorAction.AlertTeam],
      },
    ],
    [
      210,
      {
        severity: SenceErrorSeverity.Unknown,
        logLevel: SenceLogLevel.Warn,
        actions: [SenceErrorAction.TreatAsUnknown, SenceErrorAction.AlertTeam],
      },
    ],
    // 200 — "Bug de integración propio: log ERROR + alerta ... No reintentar automático".
    [
      200,
      {
        severity: SenceErrorSeverity.IntegrationBug,
        logLevel: SenceLogLevel.Error,
        actions: [SenceErrorAction.AlertTeam, SenceErrorAction.NoAutoRetry],
      },
    ],
    // 201 — "Bug de integración propio (pre-vuelo I-8 falló): log ERROR + alerta interna".
    [
      201,
      {
        severity: SenceErrorSeverity.IntegrationBug,
        logLevel: SenceLogLevel.Error,
        actions: [SenceErrorAction.AlertTeam],
      },
    ],
    // 202 — "Bug de configuración de URLs del tenant: alerta al admin del tenant + equipo".
    [
      202,
      {
        severity: SenceErrorSeverity.IntegrationBug,
        logLevel: SenceLogLevel.Error,
        actions: [
          SenceErrorAction.AlertTenantAdmin,
          SenceErrorAction.AlertTeam,
        ],
      },
    ],
    // 203 — "Ídem 202".
    [
      203,
      {
        severity: SenceErrorSeverity.IntegrationBug,
        logLevel: SenceLogLevel.Error,
        actions: [
          SenceErrorAction.AlertTenantAdmin,
          SenceErrorAction.AlertTeam,
        ],
      },
    ],
    // 204 — "Marcar la acción como mal configurada; alerta al admin del tenant".
    [
      204,
      {
        severity: SenceErrorSeverity.TenantConfig,
        logLevel: SenceLogLevel.Warn,
        actions: [
          SenceErrorAction.MarkActionMisconfigured,
          SenceErrorAction.AlertTenantAdmin,
        ],
      },
    ],
    // 205 — "Ídem 204, revisar código de ACCIÓN".
    [
      205,
      {
        severity: SenceErrorSeverity.TenantConfig,
        logLevel: SenceLogLevel.Warn,
        actions: [
          SenceErrorAction.MarkActionMisconfigured,
          SenceErrorAction.AlertTenantAdmin,
        ],
      },
    ],
    // 206 — "Alerta al admin del tenant: revisar LineaCapacitacion".
    [
      206,
      {
        severity: SenceErrorSeverity.TenantConfig,
        logLevel: SenceLogLevel.Warn,
        actions: [SenceErrorAction.AlertTenantAdmin],
      },
    ],
    // 207 — "No debería ocurrir (pre-vuelo I-8): log ERROR + alerta; marcar el perfil".
    [
      207,
      {
        severity: SenceErrorSeverity.IntegrationBug,
        logLevel: SenceLogLevel.Error,
        actions: [
          SenceErrorAction.AlertTeam,
          SenceErrorAction.MarkStudentProfile,
        ],
      },
    ],
    // 208 — "Alerta al admin del tenant: verificar nómina/comunicación".
    [
      208,
      {
        severity: SenceErrorSeverity.TenantConfig,
        logLevel: SenceLogLevel.Warn,
        actions: [SenceErrorAction.AlertTenantAdmin],
      },
    ],
    // 209 — "Configuración crítica del OTEC rota: alerta crítica al equipo + admin".
    [
      209,
      {
        severity: SenceErrorSeverity.IntegrationBug,
        logLevel: SenceLogLevel.Error,
        actions: [
          SenceErrorAction.AlertTeam,
          SenceErrorAction.AlertTenantAdmin,
        ],
      },
    ],
    // 211 — "Alerta crítica al admin del tenant: token no corresponde al RutOtec".
    [
      211,
      {
        severity: SenceErrorSeverity.TenantConfig,
        logLevel: SenceLogLevel.Error,
        actions: [SenceErrorAction.AlertTenantAdmin],
      },
    ],
    // 212 — "Alerta crítica al admin del tenant: regenerar token".
    [
      212,
      {
        severity: SenceErrorSeverity.TenantConfig,
        logLevel: SenceLogLevel.Error,
        actions: [SenceErrorAction.AlertTenantAdmin],
      },
    ],
    // 300 — "Permitir reintento del alumno; si persiste, escalar a SENCE".
    [
      300,
      {
        severity: SenceErrorSeverity.SenceSide,
        logLevel: SenceLogLevel.Warn,
        actions: [
          SenceErrorAction.RetryAllowed,
          SenceErrorAction.EscalateToSence,
        ],
      },
    ],
    // 301 — "Alerta al admin del tenant: ...; permitir reintento tras corrección".
    [
      301,
      {
        severity: SenceErrorSeverity.TenantConfig,
        logLevel: SenceLogLevel.Warn,
        actions: [
          SenceErrorAction.AlertTenantAdmin,
          SenceErrorAction.RetryAllowed,
        ],
      },
    ],
    // 302 — "Escalar a SENCE con antecedentes; alerta al equipo".
    [
      302,
      {
        severity: SenceErrorSeverity.SenceSide,
        logLevel: SenceLogLevel.Warn,
        actions: [
          SenceErrorAction.EscalateToSence,
          SenceErrorAction.AlertTeam,
        ],
      },
    ],
    // 303 — "Alerta crítica: token corrupto o mal migrado" (token → tenant admin).
    [
      303,
      {
        severity: SenceErrorSeverity.TenantConfig,
        logLevel: SenceLogLevel.Error,
        actions: [SenceErrorAction.AlertTenantAdmin],
      },
    ],
    // 304 — "Permitir reintento; si persiste, escalar a SENCE".
    [
      304,
      {
        severity: SenceErrorSeverity.SenceSide,
        logLevel: SenceLogLevel.Warn,
        actions: [
          SenceErrorAction.RetryAllowed,
          SenceErrorAction.EscalateToSence,
        ],
      },
    ],
    // 305 — "Ídem 304".
    [
      305,
      {
        severity: SenceErrorSeverity.SenceSide,
        logLevel: SenceLogLevel.Warn,
        actions: [
          SenceErrorAction.RetryAllowed,
          SenceErrorAction.EscalateToSence,
        ],
      },
    ],
    // 306 — "Alerta al admin del tenant: el par curso/acción no calza".
    [
      306,
      {
        severity: SenceErrorSeverity.TenantConfig,
        logLevel: SenceLogLevel.Warn,
        actions: [SenceErrorAction.AlertTenantAdmin],
      },
    ],
    // 307 — "Alerta al admin del tenant: ...; bloquear nuevos intentos hasta corregir".
    [
      307,
      {
        severity: SenceErrorSeverity.TenantConfig,
        logLevel: SenceLogLevel.Warn,
        actions: [
          SenceErrorAction.AlertTenantAdmin,
          SenceErrorAction.BlockAction,
        ],
      },
    ],
    // 308 — "Alerta al admin del tenant: la acción pertenece a otro OTEC ...".
    [
      308,
      {
        severity: SenceErrorSeverity.TenantConfig,
        logLevel: SenceLogLevel.Warn,
        actions: [SenceErrorAction.AlertTenantAdmin],
      },
    ],
    // 309 — "Bloquear nuevos intentos para la acción + alerta al admin del tenant".
    [
      309,
      {
        severity: SenceErrorSeverity.TenantConfig,
        logLevel: SenceLogLevel.Warn,
        actions: [
          SenceErrorAction.BlockAction,
          SenceErrorAction.AlertTenantAdmin,
        ],
      },
    ],
    // 310 — "Bloquear nuevos intentos para la acción + alerta al admin del tenant".
    [
      310,
      {
        severity: SenceErrorSeverity.TenantConfig,
        logLevel: SenceLogLevel.Warn,
        actions: [
          SenceErrorAction.BlockAction,
          SenceErrorAction.AlertTenantAdmin,
        ],
      },
    ],
    // 311 — "Permitir reintento inmediato (nueva sesión T1); ... registrar en audit_log".
    [
      311,
      {
        severity: SenceErrorSeverity.StudentRecoverable,
        logLevel: SenceLogLevel.Warn,
        actions: [SenceErrorAction.RetryAllowed, SenceErrorAction.AuditLog],
      },
    ],
    // 312 — "Permitir reintento inmediato (nueva sesión T1)".
    [
      312,
      {
        severity: SenceErrorSeverity.StudentRecoverable,
        logLevel: SenceLogLevel.Warn,
        actions: [SenceErrorAction.RetryAllowed],
      },
    ],
    // 313 — "Bug de integración propio en /api/sence/close: log ERROR + ...; reintento de cierre".
    [
      313,
      {
        severity: SenceErrorSeverity.IntegrationBug,
        logLevel: SenceLogLevel.Error,
        actions: [
          SenceErrorAction.AlertTeam,
          SenceErrorAction.EnableCloseRetry,
        ],
      },
    ],
  ]);

describe("§5 error table — completeness and verbatim glosas", () => {
  it("contains exactly the contract's codes (200–212 without 210, 300–313, plus 100/210 deprecated)", () => {
    expect([...ALL_SENCE_ERROR_CODES]).toEqual(
      [...DEPRECATED_CODES, ...ACTIVE_CODES].sort((a, b) => a - b),
    );
    expect([...ACTIVE_SENCE_ERROR_CODES]).toEqual(ACTIVE_CODES);
    expect([...DEPRECATED_SENCE_ERROR_CODES]).toEqual(DEPRECATED_CODES);
  });

  it("does NOT contain 210 among active codes", () => {
    expect(ACTIVE_SENCE_ERROR_CODES).not.toContain(210);
  });

  it.each([...EXPECTED_GLOSAS.entries()])(
    "code %i has the official glosa VERBATIM",
    (code, glosa) => {
      const entry = getSenceErrorEntry(code);
      expect(entry).toBeDefined();
      expect(entry?.officialGlosa).toBe(glosa);
    },
  );

  it("keeps the 308 (no final period) and 313 (capital 'Incorrecta') quirks", () => {
    expect(getSenceErrorEntry(308)?.officialGlosa).toBe(
      "El Código Curso no corresponde al RUT OTEC",
    );
    expect(getSenceErrorEntry(308)?.officialGlosa.endsWith(".")).toBe(false);
    expect(getSenceErrorEntry(313)?.officialGlosa).toContain("Incorrecta");
  });

  it("marks 100 and 210 as deprecated and everything else as not", () => {
    expect(getSenceErrorEntry(100)?.deprecated).toBe(true);
    expect(getSenceErrorEntry(210)?.deprecated).toBe(true);
    for (const code of ACTIVE_CODES) {
      expect(getSenceErrorEntry(code)?.deprecated).toBe(false);
    }
  });

  it("keys the table by the entry's own code", () => {
    for (const [key, entry] of Object.entries(SENCE_ERROR_TABLE)) {
      expect(entry.code).toBe(Number(key));
    }
  });

  it("references only existing es-CL message keys", () => {
    for (const entry of Object.values(SENCE_ERROR_TABLE)) {
      expect(esCL.sence.errors[entry.messageKey]).toBeTypeOf("string");
      expect(esCL.sence.errors[entry.messageKey].length).toBeGreaterThan(0);
    }
  });
});

describe("§5 'Acción del sistema' — severity / logLevel / actions per code", () => {
  it("has an independent expectation for every code in the table", () => {
    expect([...EXPECTED_SYSTEM_ACTIONS.keys()].sort((a, b) => a - b)).toEqual([
      ...ALL_SENCE_ERROR_CODES,
    ]);
  });

  it.each([...EXPECTED_SYSTEM_ACTIONS.entries()])(
    "code %i is modeled with the §5 severity, logLevel and actions",
    (code, expected) => {
      const entry = getSenceErrorEntry(code);
      expect(entry).toBeDefined();
      expect(entry?.severity).toBe(expected.severity);
      expect(entry?.logLevel).toBe(expected.logLevel);
      // Actions compared as a SET (order is not contract-frozen): catches a
      // missing or extra action without over-pinning ordering.
      expect([...(entry?.actions ?? [])].sort()).toEqual(
        [...expected.actions].sort(),
      );
      // translateSenceError surfaces the same modeling to callers.
      const t = translateSenceError(code);
      expect(t.severity).toBe(expected.severity);
      expect(t.logLevel).toBe(expected.logLevel);
      expect([...t.actions].sort()).toEqual([...expected.actions].sort());
    },
  );
});

describe("I-9 — translateSenceError is TOTAL and never leaks the raw code", () => {
  it("returns the fallback for an unknown code (999)", () => {
    const t = translateSenceError(999);
    expect(t.known).toBe(false);
    expect(t.deprecated).toBe(false);
    expect(t.studentMessage).toBe(esCL.sence.errors.fallback);
    expect(t.officialGlosa).toBeNull();
    expect(t.messageKey).toBe("fallback");
    expect(t.severity).toBe(SenceErrorSeverity.Unknown);
    expect(t.actions).toContain(SenceErrorAction.AlertTeam);
  });

  it("resolves deprecated codes (100, 210) to the fallback but flags them", () => {
    for (const code of DEPRECATED_CODES) {
      const t = translateSenceError(code);
      expect(t.deprecated).toBe(true);
      expect(t.known).toBe(false);
      expect(t.studentMessage).toBe(esCL.sence.errors.fallback);
      expect(t.actions).toContain(SenceErrorAction.TreatAsUnknown);
    }
  });

  it("maps every code to the §5 message KEY (independent of the table, non-circular)", () => {
    // Guard: the anchor covers exactly the table's codes, so a new/removed row
    // can't slip past by not having an expectation.
    expect([...EXPECTED_MESSAGE_KEYS.keys()].sort((a, b) => a - b)).toEqual([
      ...ALL_SENCE_ERROR_CODES,
    ]);
    for (const code of ALL_SENCE_ERROR_CODES) {
      const entry = getSenceErrorEntry(code);
      const expectedKey = EXPECTED_MESSAGE_KEYS.get(code);
      expect(expectedKey).toBeDefined();
      // The table's messageKey is compared against a key transcribed from §5 —
      // NOT re-read from the table — so a flipped key fails here.
      expect(entry?.messageKey).toBe(expectedKey);
      expect(translateSenceError(code).messageKey).toBe(expectedKey);
    }
  });

  it("translates every active code to its exact §5 es-CL literal (never the glosa/code)", () => {
    // Guard: an expectation exists for every active code.
    expect([...EXPECTED_STUDENT_MESSAGES.keys()].sort((a, b) => a - b)).toEqual(
      ACTIVE_CODES,
    );
    for (const code of ACTIVE_CODES) {
      const t = translateSenceError(code);
      const expectedMessage = EXPECTED_STUDENT_MESSAGES.get(code);
      expect(expectedMessage).toBeDefined();
      expect(t.known).toBe(true);
      // Pinned against a literal transcribed from §5 (via MSG) — catches a
      // flipped messageKey AND any drift between es-CL.ts and §5.
      expect(t.studentMessage).toBe(expectedMessage);
      // Never the technical glosa, never the raw code.
      expect(t.studentMessage).not.toBe(t.officialGlosa);
      expect(t.studentMessage).not.toContain(String(code));
    }
  });

  it("is total over a wide range: never throws, never undefined, never leaks the code", () => {
    for (let code = -50; code <= 400; code++) {
      const t = translateSenceError(code);
      expect(t).toBeDefined();
      expect(typeof t.studentMessage).toBe("string");
      expect(t.studentMessage.length).toBeGreaterThan(0);
      expect(t.studentMessage).not.toContain(String(code));
    }
    // Also robust against non-integer / non-finite inputs.
    for (const weird of [NaN, Infinity, -Infinity, 211.5, 0]) {
      expect(() => translateSenceError(weird)).not.toThrow();
      expect(translateSenceError(weird).studentMessage.length).toBeGreaterThan(0);
    }
  });
});

describe("I-5 — parseGlosaError splits on ';' as text", () => {
  it("parses a multi-code payload from the field ('211;204')", () => {
    expect(parseGlosaError("211;204")).toEqual([211, 204]);
  });

  it("parses a single code ('211')", () => {
    expect(parseGlosaError("211")).toEqual([211]);
  });

  it("tolerates surrounding spaces (' 211 ; 204 ')", () => {
    expect(parseGlosaError(" 211 ; 204 ")).toEqual([211, 204]);
  });

  it("returns [] for an empty string", () => {
    expect(parseGlosaError("")).toEqual([]);
  });

  it("returns [] for garbage and only-separators input", () => {
    expect(parseGlosaError("basura")).toEqual([]);
    expect(parseGlosaError("  ;  ;")).toEqual([]);
    expect(parseGlosaError(";;;")).toEqual([]);
  });

  it("ignores non-numeric tokens but keeps the numeric ones ('211;abc;204')", () => {
    expect(parseGlosaError("211;abc;204")).toEqual([211, 204]);
  });

  it("does not partially parse mixed tokens ('211abc' is invalid, not 211)", () => {
    expect(parseGlosaError("211abc")).toEqual([]);
  });

  it("reports ignored non-numeric tokens in a typed field", () => {
    const parsed = parseGlosaErrorDetailed("211;abc;204; xx ");
    expect(parsed.codes).toEqual([211, 204]);
    expect(parsed.invalidTokens).toEqual(["abc", "xx"]);
  });

  it("treats '0' as a numeric (though unknown) code", () => {
    expect(parseGlosaError("0")).toEqual([0]);
    expect(translateSenceError(0).known).toBe(false);
  });

  it("handles a huge, precision-losing numeric token without throwing ('99999999999999999999')", () => {
    const raw = "99999999999999999999"; // 20 nines → Number() loses precision
    expect(() => parseGlosaError(raw)).not.toThrow();
    const codes = parseGlosaError(raw);
    expect(codes).toHaveLength(1);
    const [code] = codes;
    expect(code).toBeDefined();
    expect(Number.isFinite(code)).toBe(true);
    // It resolves as an unknown code (no table hit) → fallback, never a throw.
    const t = translateSenceError(code!);
    expect(t.known).toBe(false);
    expect(t.studentMessage).toBe(esCL.sence.errors.fallback);
    expect(() => resolveGlosaError(raw)).not.toThrow();
    expect(resolveGlosaError(raw).studentMessage).toBe(
      esCL.sence.errors.fallback,
    );
  });
});

describe("resolveGlosaError — full GlosaError to student message + system action", () => {
  it("picks the most-severe code's message and unions the actions ('211;204')", () => {
    const r = resolveGlosaError("211;204");
    expect(r.codes).toEqual([211, 204]);
    // Both are TenantConfig → tie broken by first appearance → 211.
    expect(r.dominantCode).toBe(211);
    expect(r.severity).toBe(SenceErrorSeverity.TenantConfig);
    expect(r.studentMessage).toBe(esCL.sence.errors.tokenIssue);
    // Union: 211 → AlertTenantAdmin; 204 → MarkActionMisconfigured + AlertTenantAdmin.
    expect(r.actions).toContain(SenceErrorAction.AlertTenantAdmin);
    expect(r.actions).toContain(SenceErrorAction.MarkActionMisconfigured);
    // 211 logs ERROR → aggregate is ERROR.
    expect(r.logLevel).toBe(SenceLogLevel.Error);
  });

  it("lets an integration bug dominate a config error ('204;200')", () => {
    const r = resolveGlosaError("204;200");
    expect(r.dominantCode).toBe(200);
    expect(r.severity).toBe(SenceErrorSeverity.IntegrationBug);
    expect(r.studentMessage).toBe(esCL.sence.errors.technicalIssue);
    expect(r.logLevel).toBe(SenceLogLevel.Error);
  });

  it("resolves a single code the same as translateSenceError", () => {
    const r = resolveGlosaError("311");
    expect(r.dominantCode).toBe(311);
    expect(r.studentMessage).toBe(esCL.sence.errors.claveUnicaRunMismatch);
    expect(r.actions).toContain(SenceErrorAction.RetryAllowed);
  });

  it("falls back and alerts the team for an empty GlosaError", () => {
    const r = resolveGlosaError("");
    expect(r.codes).toEqual([]);
    expect(r.dominantCode).toBeNull();
    expect(r.studentMessage).toBe(esCL.sence.errors.fallback);
    expect(r.severity).toBe(SenceErrorSeverity.Unknown);
    expect(r.actions).toContain(SenceErrorAction.AlertTeam);
  });

  it("falls back for an all-garbage GlosaError but reports the tokens", () => {
    const r = resolveGlosaError("foo;bar");
    expect(r.dominantCode).toBeNull();
    expect(r.invalidTokens).toEqual(["foo", "bar"]);
    expect(r.studentMessage).toBe(esCL.sence.errors.fallback);
    expect(r.actions).toContain(SenceErrorAction.AlertTeam);
  });

  it("adds AlertTeam when a valid code is mixed with an invalid token ('211;abc')", () => {
    const r = resolveGlosaError("211;abc");
    expect(r.codes).toEqual([211]);
    expect(r.invalidTokens).toEqual(["abc"]);
    expect(r.dominantCode).toBe(211);
    expect(r.actions).toContain(SenceErrorAction.AlertTeam); // protocol drift
    expect(r.actions).toContain(SenceErrorAction.AlertTenantAdmin);
  });

  it("routes an unknown-only code to the fallback", () => {
    const r = resolveGlosaError("999");
    expect(r.dominantCode).toBe(999);
    expect(r.studentMessage).toBe(esCL.sence.errors.fallback);
    expect(r.severity).toBe(SenceErrorSeverity.Unknown);
  });
});

describe("I-9 — no es-CL SENCE message contains a raw code or any digit", () => {
  it("has no digits in any student-facing message", () => {
    for (const message of Object.values(esCL.sence.errors)) {
      expect(message).not.toMatch(/\d/);
    }
  });

  it("never renders any table code inside the message it maps to", () => {
    for (const code of ALL_SENCE_ERROR_CODES) {
      expect(translateSenceError(code).studentMessage).not.toContain(
        String(code),
      );
    }
  });
});
