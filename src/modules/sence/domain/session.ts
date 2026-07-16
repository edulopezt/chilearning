/**
 * The `sence_sessions` state machine and the callback discriminator.
 * Pure domain (no IO, no clock): every function that needs the current time
 * receives it as an epoch-milliseconds argument. Derived literally from the
 * frozen contract (`src/modules/sence/README.md` §3 and invariants I-4, I-13,
 * I-15).
 *
 * States (§3): `iniciada_pendiente` → `iniciada` → `cerrada` | `expirada` | `error`.
 *
 * Transitions (T1…T9 — the contract's table is EXHAUSTIVE; anything else is a
 * bug and yields no state change):
 *   T1  (∅) → iniciada_pendiente         `createPendingSession`
 *   T2  iniciada_pendiente → iniciada    start-success callback
 *   T3  iniciada_pendiente → error       start-error callback (terminal)
 *   T4  iniciada_pendiente → expirada    Clave Única abandon timeout (no callback)
 *   T5  iniciada → cerrada               close-success callback
 *   T6  iniciada → expirada              passes expires_at (worker)
 *   T7  iniciada → error                 close-error callback (non-terminal)
 *   T8  error(from T7) → cerrada         retry close-success (≤ expires_at)
 *   T9  error(from T7) → expirada        passes expires_at (worker)
 *
 * `cerrada`, `expirada` and `error`-from-T3 are terminal; a later callback that
 * correlates with a terminal session is persisted `late = true` and does NOT
 * change the state (I-15). `error`-from-T7 is NOT terminal: it leaves only via
 * T8 (retry in time) or T9 (expiry).
 *
 * TIME MODEL: a session is "expired" the instant `now >= deadline`
 * (D-048/Q-09 ratifica: "al alcanzar o superar" expires_at). Solo **T8** (el
 * REINTENTO de cierre sobre `error(close)`) está gateado por `expiresAt`
 * (`opened_at + SENCE_SESSION_MAX_HOURS`, I-13): un T8 que llega pasado el deadline
 * es `late` (I-15) y no transiciona. **T5/T7 (cierre sobre `iniciada`) NO están
 * gateados** (D-048/Q-01, README §Enmiendas E-1): un callback de cierre que llega
 * tras `expires_at` pero antes de que el worker corra T6 igual aplica su transición
 * — un cierre confirmado por SENCE es la evidencia más fuerte, y gatearlo creaba
 * falsos `expirada`. La carrera callback-vs-worker(T6) la resuelve el CAS de
 * `persistState`. Los callbacks de INICIO tampoco están gateados: su llegada prueba
 * que el alumno no abandonó (T4 es el camino "sin callback"), así que aplican
 * mientras la sesión siga `iniciada_pendiente`.
 *
 * Fronteras — RESUELTAS por Edu (D-048); el código de abajo las implementa:
 *   (Q-09/ex-Q1) `>=` vs `>` en `now === expiresAt`: RATIFICADO `>=` (expira en el
 *        instante exacto; ~1 ms de diferencia). El contrato dice "al alcanzar o superar".
 *   (Q-01/ex-Q2) puerta temporal del cierre sobre `iniciada`: ELIMINADA (T5/T7 sin
 *        puerta; solo T8 gateado) — creaba falsos `expirada` en cierres cerca del límite.
 *   (Q-10/ex-Q3) start-callback tardío vs T4: RATIFICADO como está — el CAS resuelve
 *        la carrera; la llegada del callback prueba que no hubo abandono. Guardrail:
 *        mantener el pending-timeout ≥ ~15 min para que ningún login real pierda contra T4.
 */

/** Lifecycle status of a `sence_sessions` row (§3). */
export type SenceSessionStatus =
  | "iniciada_pendiente"
  | "iniciada"
  | "cerrada"
  | "expirada"
  | "error";

/**
 * Where an `error` status came from — the two `error` flavors behave
 * differently (T3 is terminal; T7 exits via T8/T9). `null` when not in `error`.
 */
export type ErrorOrigin = "start" | "close";

/** Kind persisted on a `sence_events` row (I-4, §6). */
export type SenceEventKind =
  | "start_ok"
  | "start_error"
  | "close_ok"
  | "close_error"
  | "unmatched";

/** Transition identifiers of §3. */
export type TransitionId =
  | "T1"
  | "T2"
  | "T3"
  | "T4"
  | "T5"
  | "T6"
  | "T7"
  | "T8"
  | "T9";

/**
 * Immutable session state the pure functions operate on. All timestamps are
 * epoch milliseconds. This is the domain projection of the `sence_sessions`
 * row (§6) — the persistence layer maps it to/from columns.
 */
export interface SessionState {
  readonly status: SenceSessionStatus;
  /** Set only when `status === "error"`: T3 (`"start"`) vs T7 (`"close"`). */
  readonly errorOrigin: ErrorOrigin | null;
  /** T1 creation time — the base of the pending-abandon deadline (T4). */
  readonly createdAt: number;
  /** `opened_at` — set at T2 from the callback `FechaHora`. */
  readonly openedAt: number | null;
  /** `expires_at = opened_at + SENCE_SESSION_MAX_HOURS` — set at T2 (I-13). */
  readonly expiresAt: number | null;
  /** `closed_at` — set at T5 (and T8) from the callback `FechaHora`. */
  readonly closedAt: number | null;
  /** `IdSesionSence` — arrives at T2, required to close. */
  readonly idSesionSence: string | null;
  /** `ZonaHoraria` — may be absent in the callback; persisted if present. */
  readonly zonaHoraria: string | null;
  /** Codes parsed from the last `GlosaError` (I-5). */
  readonly errorCodes: readonly string[];
}

/** Raw callback fields the domain needs (the border adapter fills these). */
export interface RawCallback {
  /** `IdSesionAlumno` — the correlator the engine generated (§6). */
  readonly idSesionAlumno: string;
  /** `IdSesionSence` — present on start callbacks, absent on close (I-4). */
  readonly idSesionSence?: string | null;
  /** `GlosaError` — raw value; present ⇒ error class (I-4). May be multi-code. */
  readonly glosaError?: string | null;
  /** `FechaHora` parsed to epoch ms by the adapter (opened_at / closed_at). */
  readonly timestampMs?: number | null;
  /** `ZonaHoraria` — persisted if present (§6, "tolerar ausencia"). */
  readonly zonaHoraria?: string | null;
}

/** Result of classifying a callback against the correlated session (I-4). */
export interface CallbackClassification {
  /** The `sence_events.kind` this callback maps to. */
  readonly kind: SenceEventKind;
  /** True when the correlated session is (or is past) a terminal state (I-15). */
  readonly late: boolean;
  /** Codes parsed from `GlosaError` (I-5); empty for success callbacks. */
  readonly errorCodes: readonly string[];
  /**
   * Heuristic sub-type by `IdSesionSence` presence, used ONLY for `unmatched`
   * and terminal/late events (I-4 last clause): non-empty ⇒ `"start"`,
   * empty ⇒ `"close"`. `null` when the sub-type is decided by session state.
   */
  readonly heuristicSubtype: ErrorOrigin | null;
}

/** Outcome of applying a callback or an expiry check to a session. */
export interface TransitionResult {
  /**
   * The resulting state to persist. ⚠ This can DIFFER from the input even when
   * `changed === false`: a repeated close-error on an already `error(close)`
   * session refreshes `errorCodes` to the codes of the LAST `GlosaError`
   * (§6 "los códigos parseados del último GlosaError") without a status
   * transition. Persistence callers MUST always write back `state`; do NOT guard
   * the write on `changed` or the newest error codes are silently dropped.
   */
  readonly state: SessionState;
  /**
   * True when the STATUS changed (a `T`-transition fired). This is NOT a
   * "should I persist?" flag — `state` may carry updated fields (e.g. refreshed
   * `errorCodes`, see above) while `changed === false`. Use `changed` only to
   * drive transition side effects (notify the student, create attendance),
   * never to decide whether to persist `state`.
   */
  readonly changed: boolean;
  /** The transition that fired, or `null` (idempotent replay, late, no-op). */
  readonly transition: TransitionId | null;
  /** The callback classification, when the input was a callback. */
  readonly event: CallbackClassification | null;
}

/** Config for time-dependent operations (all overridable, I-13). */
export interface SessionTiming {
  /** Processing/receipt time, epoch ms. */
  readonly now: number;
  /** `SENCE_SESSION_MAX_HOURS` in ms — the `iniciada`/`error(T7)` deadline. */
  readonly sessionMaxMs: number;
  /** `SENCE_PENDING_TIMEOUT_MINUTES` in ms — the abandon (T4) deadline. */
  readonly pendingTimeoutMs: number;
}

/** Default operative durations (I-13 / T4). Callers should pass config values. */
export const DEFAULT_SESSION_MAX_MS = 3 * 60 * 60 * 1000; // 3 h
export const DEFAULT_PENDING_TIMEOUT_MS = 15 * 60 * 1000; // 15 min (D-048/Q-04; antes 60)

/**
 * Parse `GlosaError` into a list of codes (I-5): split on `;`, trim, drop empty.
 * Kept local so the pure domain has no hard dependency on `errors.ts` (which is
 * authored in parallel and owns the canonical translation table).
 */
function parseGlosaCodes(glosaError: string | null | undefined): string[] {
  if (glosaError == null) return [];
  return glosaError
    .split(";")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function isNonEmpty(value: string | null | undefined): value is string {
  return value != null && value.trim().length > 0;
}

/** Whether a status is terminal purely by its status (before any expiry check). */
function isTerminalStatus(state: SessionState): boolean {
  if (state.status === "cerrada" || state.status === "expirada") return true;
  // `error` from T3 (start) is terminal; from T7 (close) it is not.
  if (state.status === "error" && state.errorOrigin === "start") return true;
  return false;
}

/**
 * Whether a callback of CLOSE arrives past the (only) time-gated deadline.
 *
 * D-048/Q-01: SOLO T8 (reintento de cierre sobre `error(close)`) tiene puerta
 * temporal en el contrato ("mientras no se supere expires_at"). T5/T7 (cierre
 * sobre `iniciada`) NO la tienen: un callback de cierre confirmado por SENCE gana
 * hasta que el worker expire la fila (T6). Antes, un cierre a las 2h59m que
 * aterrizaba tras `expires_at` quedaba `late` → la sesión terminaba `expirada`
 * aunque SENCE la había cerrado (no-asistencia falsa). El worker (`expireSession`,
 * T6) sigue expirando `iniciada`; la carrera callback-vs-worker la resuelve el CAS.
 */
function isPastCloseDeadline(state: SessionState, now: number | undefined): boolean {
  if (now === undefined) return false;
  const closeGated = state.status === "error" && state.errorOrigin === "close";
  if (!closeGated) return false;
  return state.expiresAt !== null && now >= state.expiresAt;
}

/**
 * Discriminate a callback per invariant I-4.
 *
 * @param callback - The raw callback.
 * @param state - The correlated session, or `null` when correlation by
 *   `id_sesion_alumno` failed (the event is `unmatched`, I-1).
 * @param now - Optional receipt time (epoch ms). When provided, a CLOSE callback
 *   arriving past `expires_at` on a non-terminal session is marked `late` (I-15).
 */
export function classifyCallback(
  callback: RawCallback,
  state: SessionState | null,
  now?: number,
): CallbackClassification {
  const hasGlosa = isNonEmpty(callback.glosaError);
  const hasSence = isNonEmpty(callback.idSesionSence);
  const errorCodes = hasGlosa ? parseGlosaCodes(callback.glosaError) : [];
  const heuristicSubtype: ErrorOrigin = hasSence ? "start" : "close";

  // No correlation possible → unmatched (I-1). Sub-type is heuristic only (I-4).
  if (state === null) {
    return { kind: "unmatched", late: false, errorCodes, heuristicSubtype };
  }

  const late = isTerminalStatus(state) || isPastCloseDeadline(state, now);

  // Success class is fully determined by IdSesionSence presence (I-4).
  if (!hasGlosa) {
    const kind: SenceEventKind = hasSence ? "start_ok" : "close_ok";
    return { kind, late, errorCodes, heuristicSubtype: null };
  }

  // Error class. Sub-type by session STATE (I-4), or by heuristic when late.
  if (late) {
    const kind: SenceEventKind = hasSence ? "start_error" : "close_error";
    return { kind, late: true, errorCodes, heuristicSubtype };
  }
  // Non-terminal: iniciada_pendiente ⇒ start_error; iniciada or error(T7) ⇒ close_error.
  const kind: SenceEventKind =
    state.status === "iniciada_pendiente" ? "start_error" : "close_error";
  return { kind, late: false, errorCodes, heuristicSubtype: null };
}

/** T1 — create a brand-new pending session. */
export function createPendingSession(createdAt: number): SessionState {
  return {
    status: "iniciada_pendiente",
    errorOrigin: null,
    createdAt,
    openedAt: null,
    expiresAt: null,
    closedAt: null,
    idSesionSence: null,
    zonaHoraria: null,
    errorCodes: [],
  };
}

function noChange(
  state: SessionState,
  event: CallbackClassification | null,
): TransitionResult {
  return { state, changed: false, transition: null, event };
}

/**
 * Apply a correlated callback to the session (T2, T3, T5, T7, T8), honoring
 * idempotent replay (I-3) and late callbacks (I-15). Pure.
 *
 * Requires the correlated `state`; `unmatched` callbacks (state `null`) never
 * reach here — the caller only persists the event (I-1).
 */
export function applyCallback(
  state: SessionState,
  callback: RawCallback,
  timing: Pick<SessionTiming, "now" | "sessionMaxMs">,
): TransitionResult {
  const event = classifyCallback(callback, state, timing.now);

  // I-15 — a late callback never revives or mutates a terminal/expired session.
  if (event.late) return noChange(state, event);

  const eventTime = callback.timestampMs ?? timing.now;

  switch (event.kind) {
    case "start_ok": {
      // T2 — only from iniciada_pendiente. Replay while `iniciada` is a no-op (I-3).
      if (state.status !== "iniciada_pendiente") return noChange(state, event);
      // `opened_at` guarda la FechaHora del callback (registro), pero acotada a
      // no ser futura. El DEADLINE (`expires_at`) se ancla a la hora de RECEPCIÓN
      // del servidor (`now`), no a la FechaHora que envía SENCE: así un timestamp
      // manipulado/desfasado (o el parseo en la zona del servidor) NO puede
      // extender ni adelantar la ventana de 3 h (hallazgo M-1, I-13).
      const openedAt = Math.min(eventTime, timing.now);
      const next: SessionState = {
        ...state,
        status: "iniciada",
        openedAt,
        expiresAt: timing.now + timing.sessionMaxMs,
        idSesionSence: isNonEmpty(callback.idSesionSence) ? callback.idSesionSence : null,
        zonaHoraria: isNonEmpty(callback.zonaHoraria) ? callback.zonaHoraria : state.zonaHoraria,
      };
      return { state: next, changed: true, transition: "T2", event };
    }

    case "start_error": {
      // T3 — inicio con error; terminal (no expires_at). Only from pending.
      if (state.status !== "iniciada_pendiente") return noChange(state, event);
      const next: SessionState = {
        ...state,
        status: "error",
        errorOrigin: "start",
        errorCodes: event.errorCodes,
      };
      return { state: next, changed: true, transition: "T3", event };
    }

    case "close_ok": {
      // T5 (from iniciada) or T8 (retry from error(T7)); both set closed_at.
      if (state.status === "iniciada") {
        const next: SessionState = { ...state, status: "cerrada", closedAt: eventTime };
        return { state: next, changed: true, transition: "T5", event };
      }
      if (state.status === "error" && state.errorOrigin === "close") {
        const next: SessionState = { ...state, status: "cerrada", closedAt: eventTime };
        return { state: next, changed: true, transition: "T8", event };
      }
      return noChange(state, event);
    }

    case "close_error": {
      // T7 — cierre con error (iniciada → error). A repeated close-error on an
      // already error(T7) session refreshes its codes without a status change.
      if (state.status === "iniciada") {
        const next: SessionState = {
          ...state,
          status: "error",
          errorOrigin: "close",
          errorCodes: event.errorCodes,
        };
        return { state: next, changed: true, transition: "T7", event };
      }
      if (state.status === "error" && state.errorOrigin === "close") {
        // Repeated close-error on error(T7): the status stays `error(close)` so
        // no transition fires (changed:false), but §6 requires error_codes to
        // hold the LAST GlosaError, so the returned state carries refreshed
        // codes. The caller MUST persist `state` regardless of `changed` (see
        // TransitionResult docs) or it will keep stale error codes on the row.
        const next: SessionState = { ...state, errorCodes: event.errorCodes };
        return { state: next, changed: false, transition: null, event };
      }
      return noChange(state, event);
    }

    default:
      // "unmatched" cannot occur here (state is non-null); exhaustive by design.
      return noChange(state, event);
  }
}

/**
 * Worker-side expiry (T4, T6, T9) as a pure function of `now`.
 *
 *  - T4: `iniciada_pendiente` past `createdAt + pendingTimeoutMs` → `expirada`
 *        (Clave Única abandon; there is NO callback for this path).
 *  - T6: `iniciada` past `expiresAt` → `expirada`.
 *  - T9: `error`-from-T7 past `expiresAt` → `expirada`.
 *
 * Terminal states (and `error`-from-T3) never expire here.
 */
export function expireSession(
  state: SessionState,
  timing: Pick<SessionTiming, "now" | "pendingTimeoutMs">,
): TransitionResult {
  if (state.status === "iniciada_pendiente") {
    const deadline = state.createdAt + timing.pendingTimeoutMs;
    if (timing.now >= deadline) {
      return {
        state: { ...state, status: "expirada" },
        changed: true,
        transition: "T4",
        event: null,
      };
    }
    return noChange(state, null);
  }

  if (state.status === "iniciada") {
    if (state.expiresAt !== null && timing.now >= state.expiresAt) {
      return {
        state: { ...state, status: "expirada" },
        changed: true,
        transition: "T6",
        event: null,
      };
    }
    return noChange(state, null);
  }

  if (state.status === "error" && state.errorOrigin === "close") {
    if (state.expiresAt !== null && timing.now >= state.expiresAt) {
      return {
        state: { ...state, status: "expirada" },
        changed: true,
        transition: "T9",
        event: null,
      };
    }
    return noChange(state, null);
  }

  return noChange(state, null);
}

/**
 * Column projection of a `sence_sessions` row that the state mapping needs.
 * Shared by the engine (callbacks) and the expiry worker (task 2.6).
 */
export interface SessionStateColumns {
  readonly status: SenceSessionStatus;
  readonly error_origin: ErrorOrigin | null;
  readonly created_at: string;
  readonly opened_at: string | null;
  readonly expires_at: string | null;
  readonly closed_at: string | null;
  readonly id_sesion_sence: string | null;
  readonly zona_horaria: string | null;
  readonly error_codes: string[] | null;
}

/** Map a `sence_sessions` row to the pure domain state (no IO, no clock). */
export function rowToState(row: SessionStateColumns): SessionState {
  return {
    status: row.status,
    errorOrigin: row.error_origin,
    createdAt: Date.parse(row.created_at),
    openedAt: row.opened_at ? Date.parse(row.opened_at) : null,
    expiresAt: row.expires_at ? Date.parse(row.expires_at) : null,
    closedAt: row.closed_at ? Date.parse(row.closed_at) : null,
    idSesionSence: row.id_sesion_sence,
    zonaHoraria: row.zona_horaria,
    errorCodes: row.error_codes ?? [],
  };
}
