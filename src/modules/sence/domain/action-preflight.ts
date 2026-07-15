/**
 * Task 2.7 (HU-5.8) — pre-flight MASIVO de una acción SENCE, dominio puro.
 * El checklist que el coordinador corre ANTES del inicio: valida el RUN/DV de
 * TODOS los inscritos (ataca en origen los errores 207/208), la configuración
 * del OTEC (token presente, RUT), los códigos SENCE de la acción/curso, el
 * ambiente y las fechas, y el estado del envío de la guía Clave Única.
 *
 * Compone los MISMOS sub-validadores del pre-flight por-registro (I-8,
 * `preflight.ts`) — una sola fuente de reglas. El token JAMÁS entra aquí: el
 * servicio lo descifra una vez, deriva `hasToken`/`tokenLengthOk` y lo
 * descarta (I-6/I-7).
 *
 * Límite honesto (documentado): 207/208 también ocurren cuando el alumno no
 * está en la nómina del registro SENCE, y eso NO es verificable localmente
 * (no existe API de consulta). Este checklist elimina la causa LOCAL (RUN mal
 * digitado / DV inválido / configuración rota).
 */

import {
  validateActionCode,
  validateRunField,
  validateSenceCourseCode,
  type PreflightViolation,
} from "./preflight";

export type ChecklistItemId =
  | "config_token"
  | "config_rut_otec"
  | "sence_course_code"
  | "action_code"
  | "environment"
  | "dates"
  | "runs"
  | "clave_unica_guide";

export type ItemStatus = "ok" | "warning" | "error";

export interface ChecklistItem {
  readonly id: ChecklistItemId;
  readonly status: ItemStatus;
  /** Sub-clave i18n del detalle (la UI la resuelve en es-CL). */
  readonly detailKey: string;
  readonly meta?: Readonly<Record<string, string | number>>;
}

export interface EnrollmentRunInput {
  readonly enrollmentId: string;
  readonly run: string;
  readonly exento: boolean;
}

export interface ActionPreflightInput {
  readonly action: {
    readonly codigoAccion: string;
    readonly trainingLine: number;
    readonly environment: string;
    readonly startsOn: string | null; // YYYY-MM-DD
    readonly endsOn: string | null;
  };
  readonly course: { readonly codSence: string | null };
  /** Derivados del token (el valor jamás llega al dominio, I-6). NULL = sin
   *  fila de config. `tokenOk` = descifrable Y dentro del largo normativo
   *  (falla también si rotó la clave de cifrado y el token quedó ilegible). */
  readonly config: {
    readonly rutOtec: string;
    readonly hasToken: boolean;
    readonly tokenOk: boolean;
  } | null;
  readonly enrollments: readonly EnrollmentRunInput[];
  /** Hoy en America/Santiago (YYYY-MM-DD), inyectado por el servicio. */
  readonly todayIsoDate: string;
  /** Última marca de guía enviada (audit_log), o null si nunca. */
  readonly guideSentAt: string | null;
}

export interface InvalidRunRow {
  readonly enrollmentId: string;
  readonly run: string;
  readonly rule: PreflightViolation["rule"];
  readonly exento: boolean;
}

export interface ActionPreflightChecklist {
  readonly items: readonly ChecklistItem[];
  readonly invalidRuns: readonly InvalidRunRow[];
  readonly overall: ItemStatus;
}

const STATUS_RANK: Record<ItemStatus, number> = { ok: 0, warning: 1, error: 2 };

function worst(statuses: ItemStatus[]): ItemStatus {
  return statuses.reduce((acc, s) => (STATUS_RANK[s] > STATUS_RANK[acc] ? s : acc), "ok");
}

/** Evalúa el checklist completo. Puro; nunca lanza. */
export function evaluateActionPreflight(input: ActionPreflightInput): ActionPreflightChecklist {
  const items: ChecklistItem[] = [];
  const isRceTest = input.action.environment === "rcetest";

  // --- config_token: sin token no hay protocolo (HU-5.4). ---
  if (input.config === null) {
    items.push({ id: "config_token", status: "error", detailKey: "noConfig" });
  } else if (!input.config.hasToken) {
    items.push({ id: "config_token", status: "error", detailKey: "noToken" });
  } else if (!input.config.tokenOk) {
    items.push({ id: "config_token", status: "error", detailKey: "tokenInvalid" });
  } else {
    items.push({ id: "config_token", status: "ok", detailKey: "tokenOk" });
  }

  // --- config_rut_otec ---
  // CRUDO, sin normalizar (revisión R-1 del PR #33): el motor pasa el valor
  // ALMACENADO tal cual a su pre-flight I-8; validar una copia normalizada
  // aquí produce un "falso verde" si la BD guardara un valor sin normalizar.
  // El checklist valida EXACTAMENTE lo que el motor consumirá.
  if (input.config === null) {
    items.push({ id: "config_rut_otec", status: "error", detailKey: "noConfig" });
  } else {
    const violations = validateRunField("rutOtec", input.config.rutOtec);
    items.push(
      violations.length === 0
        ? { id: "config_rut_otec", status: "ok", detailKey: "rutOk" }
        : { id: "config_rut_otec", status: "error", detailKey: "rutInvalid" },
    );
  }

  // --- sence_course_code (CodSence — ataca el error 204 en origen) ---
  {
    const value = input.course.codSence ?? "";
    const violations = validateSenceCourseCode(value, input.action.trainingLine, isRceTest);
    if (violations.length === 0) {
      items.push({ id: "sence_course_code", status: "ok", detailKey: "codSenceOk" });
    } else {
      const rule = violations[0]?.rule ?? "required";
      items.push({
        id: "sence_course_code",
        status: "error",
        detailKey: rule === "must_be_empty" ? "codSenceMustBeEmpty" : "codSenceInvalid",
        meta: { rule },
      });
    }
  }

  // --- action_code (CodigoCurso; formato SIC en línea 1, ≥7 salvo línea 6) ---
  {
    const violations = validateActionCode(
      input.action.codigoAccion,
      input.action.trainingLine,
      isRceTest,
    );
    items.push(
      violations.length === 0
        ? { id: "action_code", status: "ok", detailKey: "actionCodeOk" }
        : {
            id: "action_code",
            status: "error",
            detailKey: "actionCodeInvalid",
            meta: { rule: violations[0]?.rule ?? "required" },
          },
    );
  }

  // --- environment (I-11): rcetest es legítimo pre-certificación → warning informativo. ---
  if (input.action.environment !== "rcetest" && input.action.environment !== "rce") {
    items.push({ id: "environment", status: "error", detailKey: "environmentInvalid" });
  } else if (isRceTest) {
    items.push({ id: "environment", status: "warning", detailKey: "environmentRcetest" });
  } else {
    items.push({ id: "environment", status: "ok", detailKey: "environmentRce" });
  }

  // --- dates: HU-3.2 exige rango para registrar asistencia. ---
  {
    const { startsOn, endsOn } = input.action;
    if (!startsOn || !endsOn) {
      items.push({ id: "dates", status: "error", detailKey: "datesMissing" });
    } else if (startsOn > endsOn) {
      items.push({ id: "dates", status: "error", detailKey: "datesInverted" });
    } else if (endsOn < input.todayIsoDate) {
      // Acción TERMINADA (revisión R-2 del PR #33): los intentos de asistencia
      // serán previsiblemente rechazados (código 309 si las fechas comunicadas
      // a SENCE coinciden). No es "ya comenzó": es que ya se acabó.
      items.push({ id: "dates", status: "error", detailKey: "datesEnded" });
    } else if (startsOn < input.todayIsoDate) {
      items.push({ id: "dates", status: "warning", detailKey: "datesStarted" });
    } else {
      items.push({ id: "dates", status: "ok", detailKey: "datesOk" });
    }
  }

  // --- runs: el gate del hito — RUN inválidos plantados DEBEN aparecer. ---
  // ⚠ CRUDO, sin normalizar (revisión R-1 del PR #33): el motor valida
  // `enrollment.run` tal cual está ALMACENADO (engine → validatePreflight).
  // El import CSV normaliza antes de persistir, así que el flujo soportado
  // siempre guarda normalizado; si algo llegó a la BD sin normalizar
  // (edición manual, SQL ad-hoc), el alumno chocará con el motor — y este
  // checklist DEBE decirlo, no taparlo validando una copia arreglada.
  const invalidRuns: InvalidRunRow[] = [];
  for (const e of input.enrollments) {
    const violations = validateRunField("runAlumno", e.run);
    if (violations.length > 0) {
      invalidRuns.push({
        enrollmentId: e.enrollmentId,
        run: e.run,
        rule: violations[0]?.rule ?? "required",
        exento: e.exento,
      });
    }
  }
  const invalidNonExempt = invalidRuns.filter((r) => !r.exento).length;
  const invalidExempt = invalidRuns.length - invalidNonExempt;
  if (input.enrollments.length === 0) {
    items.push({ id: "runs", status: "warning", detailKey: "runsEmpty" });
  } else if (invalidNonExempt > 0) {
    items.push({
      id: "runs",
      status: "error",
      detailKey: "runsInvalid",
      meta: { invalid: invalidNonExempt, total: input.enrollments.length },
    });
  } else if (invalidExempt > 0) {
    // Un exento no viaja a SENCE (I-14): su RUN malo no bloquea, pero se avisa.
    items.push({
      id: "runs",
      status: "warning",
      detailKey: "runsInvalidExempt",
      meta: { invalid: invalidExempt, total: input.enrollments.length },
    });
  } else {
    items.push({
      id: "runs",
      status: "ok",
      detailKey: "runsOk",
      meta: { total: input.enrollments.length },
    });
  }

  // --- clave_unica_guide: enviada = ok; nunca = warning (no bloquea). ---
  items.push(
    input.guideSentAt
      ? { id: "clave_unica_guide", status: "ok", detailKey: "guideSent", meta: { at: input.guideSentAt } }
      : { id: "clave_unica_guide", status: "warning", detailKey: "guideNotSent" },
  );

  return {
    items,
    invalidRuns,
    overall: worst(items.map((i) => i.status)),
  };
}
