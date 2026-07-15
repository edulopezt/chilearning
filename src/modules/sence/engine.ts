import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { type TenantGuard } from "@/lib/tenant-guard";
import { decryptToken } from "@/modules/sence/domain/token-crypto";
import { validatePreflight, type PreflightViolation } from "@/modules/sence/domain/preflight";
import {
  buildIdSesionAlumno,
  computeDedupeHash,
  parseFechaHora,
  resolveEndpoint,
  stripToken,
  type SenceEnvironment,
} from "@/modules/sence/domain/protocol";
import {
  applyCallback,
  classifyCallback,
  DEFAULT_SESSION_MAX_MS,
  rowToState,
  type RawCallback,
  type SenceEventKind,
  type SenceSessionStatus,
  type SessionState,
  type SessionStateColumns,
} from "@/modules/sence/domain/session";

/**
 * Servicio del motor SENCE (task 0.7) — la joya de la corona. Orquesta dominio
 * (puro) + BD (vía tenantGuard, service-role) + cifrado del token. Todas las
 * escrituras pasan por el servidor: el callback de SENCE no viene autenticado.
 *
 * Invariantes que este archivo hace cumplir: I-1 (persistir SIEMPRE el evento),
 * I-3 (idempotencia por dedupe_hash), I-6/I-7 (token cifrado, nunca en logs ni
 * en el payload del evento), I-8 (pre-vuelo antes de enviar al alumno).
 */

export interface EngineDeps {
  /** Clave AES-256-GCM ya parseada (32 bytes). */
  encryptionKey: Buffer;
  /** Override de la base de SENCE por ambiente (para el mock local). */
  baseOverride?: Partial<Record<SenceEnvironment, string>>;
  /** Base absoluta del receptor de callbacks (`…/api/sence/cb`); se le agrega
   *  `/{nonce}` por sesión. El total debe caber en 100 chars (I-8). */
  callbackUrl: string;
  now: () => number;
  newUuid: () => string;
  /** Genera el nonce de callback por sesión (corto, ~16 chars, H-2). */
  newNonce: () => string;
  /** Ventana operativa de sesión en ms (I-13, `SENCE_SESSION_MAX_HOURS`);
   *  T2 ancla `expires_at = recepción + sessionMaxMs`. Default: 3 h. */
  sessionMaxMs?: number;
}

export type StartResult =
  | { readonly kind: "exempt"; readonly enrollmentId: string }
  | { readonly kind: "preflight_error"; readonly violations: readonly PreflightViolation[] }
  | {
      readonly kind: "ready";
      readonly endpoint: string;
      readonly fields: Record<string, string>;
      readonly sessionId: string;
    };

interface EnrollmentRow {
  id: string;
  tenant_id: string;
  action_id: string;
  user_id: string;
  run: string;
  exento: boolean;
}
interface ActionRow {
  id: string;
  course_id: string;
  codigo_accion: string;
  training_line: number;
  environment: SenceEnvironment;
}
interface CourseRow {
  id: string;
  cod_sence: string | null;
}
interface OtecConfigRow {
  rut_otec: string;
  token_encrypted: string | null;
}

function baseFor(env: SenceEnvironment, deps: EngineDeps): string | undefined {
  return deps.baseOverride?.[env];
}

/**
 * Inicia el registro de asistencia (T1). Lee la inscripción y su acción/curso/
 * config del OTEC (todo acotado al tenant del guard), corre el pre-vuelo (I-8) y,
 * si pasa, crea la sesión `iniciada_pendiente` y devuelve el form POST hacia
 * `IniciarSesion` (con el token descifrado — único lugar donde el token sale,
 * I-7). Un alumno exento salta SENCE sin bloquearse (I-14).
 */
export async function startSession(
  guard: TenantGuard,
  enrollmentId: string,
  requestingUserId: string,
  deps: EngineDeps,
): Promise<StartResult> {
  const enrollment = await readOne<EnrollmentRow>(
    guard.from("enrollments").eq("id", enrollmentId).limit(1),
    "enrollment",
  );
  guard.assertTenant(enrollment.tenant_id);
  // El alumno solo inicia SU propia asistencia (no la de otro).
  if (enrollment.user_id !== requestingUserId) {
    throw new EngineError("La inscripción no pertenece al usuario que la solicita.");
  }

  if (enrollment.exento) {
    return { kind: "exempt", enrollmentId };
  }

  const action = await readOne<ActionRow>(
    guard.from("actions").eq("id", enrollment.action_id).limit(1),
    "action",
  );
  const course = await readOne<CourseRow>(
    guard.from("courses").eq("id", action.course_id).limit(1),
    "course",
  );
  const config = await readOne<OtecConfigRow>(
    guard.db
      .from("sence_otec_config")
      .select("rut_otec, token_encrypted")
      .eq("tenant_id", guard.tenantId)
      .limit(1),
    "sence_otec_config",
  );
  if (!config.token_encrypted) {
    throw new EngineError("El OTEC no tiene configurado su token SENCE.");
  }

  // El token solo se descifra en memoria aquí (I-6/I-7). Nunca se registra.
  const token = decryptToken(config.token_encrypted, deps.encryptionKey);

  const idSesionAlumno = buildIdSesionAlumno(deps.newUuid());
  const senceCourseCode = action.training_line === 1 ? "" : (course.cod_sence ?? "");
  // Nonce por sesión (H-2): la URL de callback lo lleva; SENCE lo devuelve tal
  // cual. Solo quien tenga el navegador de esta sesión lo conoce.
  const nonce = deps.newNonce();
  const callbackUrl = `${deps.callbackUrl}/${nonce}`;

  const preflight = validatePreflight({
    phase: "start",
    environment: action.environment,
    trainingLine: action.training_line,
    rutOtec: config.rut_otec,
    token,
    senceCourseCode,
    actionCode: action.codigo_accion,
    runAlumno: enrollment.run,
    idSesionAlumno,
    urlRetoma: callbackUrl,
    urlError: callbackUrl,
  });
  if (!preflight.ok) {
    return { kind: "preflight_error", violations: preflight.violations };
  }

  const sessionId = deps.newUuid();
  const { error } = await guard.db.from("sence_sessions").insert(
    guard.withTenant({
      id: sessionId,
      enrollment_id: enrollment.id,
      sence_course_code: senceCourseCode === "" ? null : senceCourseCode,
      action_code: action.codigo_accion,
      training_line: action.training_line,
      run_alumno: enrollment.run,
      id_sesion_alumno: idSesionAlumno,
      status: "iniciada_pendiente",
      environment: action.environment,
      callback_nonce: nonce,
    }),
  );
  if (error) throw new EngineError(`No se pudo crear la sesión: ${error.message}`);

  return {
    kind: "ready",
    sessionId,
    endpoint: resolveEndpoint(action.environment, "start", baseFor(action.environment, deps)),
    fields: {
      RutOtec: config.rut_otec,
      Token: token,
      LineaCapacitacion: String(action.training_line),
      RunAlumno: enrollment.run,
      IdSesionAlumno: idSesionAlumno,
      UrlRetoma: callbackUrl,
      UrlError: callbackUrl,
      CodSence: senceCourseCode,
      CodigoCurso: action.codigo_accion,
    },
  };
}

export interface CallbackResult {
  readonly eventKind: SenceEventKind;
  readonly matched: boolean;
  readonly late: boolean;
  readonly newStatus: SenceSessionStatus | null;
  /** False si el evento no se pudo persistir (I-1 crítico) o se descartó basura. */
  readonly persisted: boolean;
}

/**
 * Recibe un callback de SENCE (los 4 tipos, I-4). Lo persiste SIEMPRE (I-1) de
 * forma idempotente (I-3), y transiciona la sesión correlacionada. Corre con
 * service-role porque el POST viene del navegador del alumno (origin SENCE), sin
 * sesión propia. Si la correlación falla, el evento se guarda igual (`unmatched`,
 * tenant NULL).
 */
export async function handleCallback(
  serviceDb: SupabaseClient,
  rawParams: Record<string, string>,
  deps: EngineDeps,
  expectedNonce?: string | null,
): Promise<CallbackResult> {
  const idSesionAlumno = (rawParams.IdSesionAlumno ?? "").trim();

  // M-4: no persistir POSTs sin forma de callback (evita inflar la tabla
  // INSERT-only, que no se puede podar). Un callback real trae un
  // `IdSesionAlumno` no vacío y ≤149 chars.
  if (idSesionAlumno === "" || idSesionAlumno.length > 149) {
    return { eventKind: "unmatched", matched: false, late: false, newStatus: null, persisted: false };
  }

  const callback: RawCallback = {
    idSesionAlumno,
    idSesionSence: rawParams.IdSesionSence ?? null,
    glosaError: rawParams.GlosaError ?? null,
    timestampMs: parseFechaHora(rawParams.FechaHora),
    zonaHoraria: rawParams.ZonaHoraria ?? null,
  };

  // Correlación por IdSesionAlumno (service-role: sin contexto de tenant aún).
  const { data: sessionRow } = await serviceDb
    .from("sence_sessions")
    .select("*")
    .eq("id_sesion_alumno", idSesionAlumno)
    .limit(1)
    .maybeSingle();

  // H-2: la sesión solo se transiciona si el nonce del callback coincide con el
  // de la sesión. Si existe la sesión pero el nonce no calza, el callback es
  // sospechoso (posible falsificación cross-sesión): se persiste como `unmatched`
  // (I-1) pero NO transiciona nada.
  const nonceOk = sessionRow != null && sessionRow.callback_nonce === (expectedNonce ?? null);
  const correlated = nonceOk ? sessionRow : null;

  const now = deps.now();
  const state = correlated ? rowToState(correlated) : null;
  const transition = state
    ? applyCallback(state, callback, {
        now,
        sessionMaxMs: deps.sessionMaxMs ?? DEFAULT_SESSION_MAX_MS,
      })
    : null;

  // Clasificación: sin sesión correlacionada, el dominio la marca `unmatched`.
  const classification = transition?.event ?? classifyCallback(callback, null, now);
  const tenantId: string | null = correlated?.tenant_id ?? null;
  const cleanPayload = stripToken(rawParams);
  const dedupeHash = computeDedupeHash(cleanPayload, classification.kind);

  // Persistir SIEMPRE (I-1): perder un callback es perder evidencia. El índice de
  // dedupe es NO-único (C-1), así que un replay legítimo persiste un 2º evento.
  const { error: insertError } = await serviceDb.from("sence_events").insert({
    tenant_id: tenantId,
    session_id: correlated?.id ?? null,
    kind: classification.kind,
    payload: cleanPayload, // I-7: sin token
    glosa_error_raw: callback.glosaError,
    error_codes: [...classification.errorCodes],
    late: classification.late,
    dedupe_hash: dedupeHash,
  });
  if (insertError) {
    // I-1 crítico: no se pudo persistir. Se registra (M-3; el alerting completo
    // se cablea con la observabilidad del Hito 3) y NO se transiciona: nunca se
    // avanza la sesión sin evidencia.
    console.error("[sence] fallo crítico al persistir sence_events", {
      kind: classification.kind,
      code: insertError.code,
    });
    return {
      eventKind: classification.kind,
      matched: correlated != null,
      late: classification.late,
      newStatus: null,
      persisted: false,
    };
  }

  // M-3: logging de callbacks de error y de nonces inválidos (I-9 pide además
  // alerta interna; se completa con la observabilidad del Hito 3).
  if (classification.kind === "start_error" || classification.kind === "close_error") {
    console.warn("[sence] callback de error", {
      kind: classification.kind,
      codes: classification.errorCodes,
    });
  }
  if (sessionRow != null && !nonceOk) {
    console.warn("[sence] callback con nonce inválido (posible falsificación)", { idSesionAlumno });
  }

  // Transición con compare-and-set (H-3): solo si el estado previo sigue igual;
  // una escritura concurrente (o un callback forjado en carrera) no la pisa.
  if (correlated && transition) {
    await persistState(serviceDb, correlated.tenant_id, correlated.id, correlated.status, transition.state);
  }

  return {
    eventKind: classification.kind,
    matched: correlated != null,
    late: classification.late,
    newStatus: transition ? transition.state.status : null,
    persisted: true,
  };
}

// ---------- helpers ----------

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}

async function readOne<T>(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw new EngineError(`Error leyendo ${what}: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new EngineError(`No se encontró ${what}`);
  return row as T;
}

// El mapeo fila→estado vive en el dominio (`rowToState`): lo comparten este
// motor y el worker de expiración (task 2.6).
type SessionRow = SessionStateColumns;

async function persistState(
  db: SupabaseClient,
  tenantId: string,
  sessionId: string,
  priorStatus: SenceSessionStatus,
  state: SessionState,
): Promise<void> {
  // Compare-and-set (H-3): la actualización solo aplica si el estado sigue en
  // `priorStatus`. Si otra escritura concurrente ya lo cambió, esta transición
  // (calculada sobre un estado viejo) NO la pisa — afecta 0 filas y se descarta.
  const { error, count } = await db
    .from("sence_sessions")
    .update(
      {
        status: state.status,
        error_origin: state.errorOrigin,
        opened_at: state.openedAt ? new Date(state.openedAt).toISOString() : null,
        expires_at: state.expiresAt ? new Date(state.expiresAt).toISOString() : null,
        closed_at: state.closedAt ? new Date(state.closedAt).toISOString() : null,
        id_sesion_sence: state.idSesionSence,
        zona_horaria: state.zonaHoraria,
        error_codes: [...state.errorCodes],
      },
      { count: "exact" },
    )
    .eq("id", sessionId)
    .eq("tenant_id", tenantId)
    .eq("status", priorStatus);
  if (error) throw new EngineError(`No se pudo actualizar la sesión: ${error.message}`);
  if (count === 0 && state.status !== priorStatus) {
    console.warn("[sence] transición descartada por carrera (compare-and-set)", {
      sessionId,
      priorStatus,
    });
  }
}

/**
 * Construye el form POST de cierre (T5/T8): CerrarSesion con el IdSesionSence.
 */
export async function buildCloseForm(
  guard: TenantGuard,
  sessionId: string,
  requestingUserId: string,
  deps: EngineDeps,
): Promise<{ endpoint: string; fields: Record<string, string> } | { error: "not_closable" }> {
  const session = await readOne<
    SessionRow & {
      id: string;
      enrollment_id: string;
      environment: SenceEnvironment;
      id_sesion_alumno: string;
      run_alumno: string;
      action_code: string;
      sence_course_code: string | null;
      training_line: number;
      callback_nonce: string | null;
    }
  >(
    guard.from("sence_sessions").eq("id", sessionId).limit(1),
    "sence_session",
  );

  // H-1: SOLO el alumno dueño de la inscripción puede cerrar su sesión. Sin esto,
  // cualquier usuario del tenant que conozca un sessionId recibiría el token del
  // OTEC (que va en el form) y el RUN de la víctima, y podría cerrar su sesión.
  const enrollment = await readOne<EnrollmentRow>(
    guard.from("enrollments").eq("id", session.enrollment_id).limit(1),
    "enrollment",
  );
  if (enrollment.user_id !== requestingUserId) {
    throw new EngineError("La sesión no pertenece al usuario que la solicita.");
  }

  if (!session.id_sesion_sence || session.status !== "iniciada") {
    return { error: "not_closable" };
  }
  const config = await readOne<OtecConfigRow>(
    guard.db
      .from("sence_otec_config")
      .select("rut_otec, token_encrypted")
      .eq("tenant_id", guard.tenantId)
      .limit(1),
    "sence_otec_config",
  );
  if (!config.token_encrypted) throw new EngineError("El OTEC no tiene token SENCE.");
  const token = decryptToken(config.token_encrypted, deps.encryptionKey);

  // Reusa el nonce de la sesión en la URL de cierre (H-2).
  const callbackUrl = session.callback_nonce
    ? `${deps.callbackUrl}/${session.callback_nonce}`
    : deps.callbackUrl;

  return {
    endpoint: resolveEndpoint(session.environment, "close", baseFor(session.environment, deps)),
    fields: {
      RutOtec: config.rut_otec,
      Token: token,
      LineaCapacitacion: String(session.training_line),
      RunAlumno: session.run_alumno,
      IdSesionAlumno: session.id_sesion_alumno,
      IdSesionSence: session.id_sesion_sence,
      UrlRetoma: callbackUrl,
      UrlError: callbackUrl,
      CodSence: session.sence_course_code ?? "",
      CodigoCurso: session.action_code,
    },
  };
}
