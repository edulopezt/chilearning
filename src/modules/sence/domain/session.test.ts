import { describe, expect, it } from "vitest";
import {
  applyCallback,
  classifyCallback,
  createPendingSession,
  DEFAULT_PENDING_TIMEOUT_MS,
  DEFAULT_SESSION_MAX_MS,
  expireSession,
  type RawCallback,
  type SessionState,
} from "./session";

const T0 = 1_700_000_000_000; // arbitrary fixed epoch ms (no clock is read)
const SESSION_MAX = DEFAULT_SESSION_MAX_MS;
const PENDING = DEFAULT_PENDING_TIMEOUT_MS;

const applyTiming = (now: number) => ({ now, sessionMaxMs: SESSION_MAX });
const expiryTiming = (now: number) => ({ now, pendingTimeoutMs: PENDING });

/** A started (`iniciada`) session opened at `openedAt`. */
function startedSession(openedAt = T0 + 5_000): SessionState {
  const pending = createPendingSession(T0);
  const cb: RawCallback = {
    idSesionAlumno: "A1",
    idSesionSence: "SENCE-1",
    timestampMs: openedAt,
    zonaHoraria: "America/Santiago",
  };
  const result = applyCallback(pending, cb, applyTiming(openedAt));
  return result.state;
}

/** An `error`-from-T7 session (close error while still within expires_at). */
function closeErrorSession(): SessionState {
  const started = startedSession();
  const cb: RawCallback = { idSesionAlumno: "A1", glosaError: "300" };
  return applyCallback(started, cb, applyTiming(T0 + 6_000)).state;
}

describe("T1 — (∅) → iniciada_pendiente", () => {
  it("creates a pending session with no timestamps yet", () => {
    const s = createPendingSession(T0);
    expect(s.status).toBe("iniciada_pendiente");
    expect(s.createdAt).toBe(T0);
    expect(s.openedAt).toBeNull();
    expect(s.expiresAt).toBeNull();
    expect(s.errorOrigin).toBeNull();
  });
});

describe("T2 — iniciada_pendiente → iniciada (start success)", () => {
  it("stores id_sesion_sence, opened_at and expires_at = opened_at + max (I-13)", () => {
    const pending = createPendingSession(T0);
    const openedAt = T0 + 5_000;
    const result = applyCallback(
      pending,
      { idSesionAlumno: "A1", idSesionSence: "SENCE-1", timestampMs: openedAt, zonaHoraria: "America/Santiago" },
      applyTiming(openedAt),
    );
    expect(result.transition).toBe("T2");
    expect(result.changed).toBe(true);
    expect(result.state.status).toBe("iniciada");
    expect(result.state.idSesionSence).toBe("SENCE-1");
    expect(result.state.openedAt).toBe(openedAt);
    expect(result.state.expiresAt).toBe(openedAt + SESSION_MAX);
    expect(result.state.zonaHoraria).toBe("America/Santiago");
  });

  it("tolerates a missing ZonaHoraria (§6)", () => {
    const pending = createPendingSession(T0);
    const result = applyCallback(
      pending,
      { idSesionAlumno: "A1", idSesionSence: "SENCE-1", timestampMs: T0 },
      applyTiming(T0),
    );
    expect(result.state.status).toBe("iniciada");
    expect(result.state.zonaHoraria).toBeNull();
  });
});

describe("T3 — iniciada_pendiente → error (start error, terminal)", () => {
  it("parses and stores the GlosaError codes (I-5) and has no expires_at", () => {
    const pending = createPendingSession(T0);
    const result = applyCallback(
      pending,
      { idSesionAlumno: "A1", glosaError: "211;204" },
      applyTiming(T0 + 1_000),
    );
    expect(result.transition).toBe("T3");
    expect(result.state.status).toBe("error");
    expect(result.state.errorOrigin).toBe("start");
    expect(result.state.errorCodes).toEqual(["211", "204"]);
    expect(result.state.expiresAt).toBeNull();
  });

  it("classifies a start error with EMPTY IdSesionSence as start_error by state (I-4)", () => {
    const pending = createPendingSession(T0);
    const cb: RawCallback = { idSesionAlumno: "A1", glosaError: "303", idSesionSence: "" };
    const cls = classifyCallback(cb, pending);
    expect(cls.kind).toBe("start_error");
    const result = applyCallback(pending, cb, applyTiming(T0 + 1_000));
    expect(result.transition).toBe("T3");
  });

  it("classifies a start error that DOES carry IdSesionSence as start_error by state too (I-4)", () => {
    const pending = createPendingSession(T0);
    const cb: RawCallback = { idSesionAlumno: "A1", glosaError: "211", idSesionSence: "SENCE-9" };
    expect(classifyCallback(cb, pending).kind).toBe("start_error");
  });
});

describe("T4 — iniciada_pendiente → expirada (Clave Única abandon, NO callback)", () => {
  it("expires once the pending timeout passes, with no callback involved", () => {
    const pending = createPendingSession(T0);
    const result = expireSession(pending, expiryTiming(T0 + PENDING));
    expect(result.transition).toBe("T4");
    expect(result.state.status).toBe("expirada");
    expect(result.event).toBeNull();
  });

  it("does not expire before the pending timeout", () => {
    const pending = createPendingSession(T0);
    const result = expireSession(pending, expiryTiming(T0 + PENDING - 1));
    expect(result.changed).toBe(false);
    expect(result.state.status).toBe("iniciada_pendiente");
  });
});

describe("T5 — iniciada → cerrada (close success)", () => {
  it("closes with closed_at from the callback FechaHora", () => {
    const started = startedSession();
    const closedAt = T0 + 10_000;
    const result = applyCallback(
      started,
      { idSesionAlumno: "A1", timestampMs: closedAt },
      applyTiming(closedAt),
    );
    expect(result.transition).toBe("T5");
    expect(result.state.status).toBe("cerrada");
    expect(result.state.closedAt).toBe(closedAt);
  });
});

describe("T6 — iniciada → expirada (passes expires_at, worker)", () => {
  it("expires exactly at expires_at", () => {
    const started = startedSession();
    const at = started.expiresAt as number;
    const result = expireSession(started, expiryTiming(at));
    expect(result.transition).toBe("T6");
    expect(result.state.status).toBe("expirada");
  });

  it("does not expire before expires_at", () => {
    const started = startedSession();
    const at = (started.expiresAt as number) - 1;
    expect(expireSession(started, expiryTiming(at)).changed).toBe(false);
  });
});

describe("T7 — iniciada → error (close error, non-terminal)", () => {
  it("moves to error(close) and keeps expires_at", () => {
    const started = startedSession();
    const result = applyCallback(
      started,
      { idSesionAlumno: "A1", glosaError: "313" },
      applyTiming(T0 + 6_000),
    );
    expect(result.transition).toBe("T7");
    expect(result.state.status).toBe("error");
    expect(result.state.errorOrigin).toBe("close");
    expect(result.state.errorCodes).toEqual(["313"]);
    expect(result.state.expiresAt).toBe(started.expiresAt);
  });
});

describe("T8 — error(from T7) → cerrada (retry close success ≤ expires_at)", () => {
  it("closes on a successful close retry within expires_at", () => {
    const errored = closeErrorSession();
    const closedAt = T0 + 7_000;
    const result = applyCallback(
      errored,
      { idSesionAlumno: "A1", timestampMs: closedAt },
      applyTiming(closedAt),
    );
    expect(result.transition).toBe("T8");
    expect(result.state.status).toBe("cerrada");
    expect(result.state.closedAt).toBe(closedAt);
  });

  it("a repeated close error on error(T7) refreshes codes without changing status", () => {
    const errored = closeErrorSession();
    const result = applyCallback(
      errored,
      { idSesionAlumno: "A1", glosaError: "305" },
      applyTiming(T0 + 6_500),
    );
    expect(result.changed).toBe(false);
    expect(result.transition).toBeNull();
    expect(result.state.status).toBe("error");
    expect(result.state.errorCodes).toEqual(["305"]);
  });
});

describe("T9 — error(from T7) → expirada (passes expires_at, worker)", () => {
  it("expires the error(close) session at expires_at", () => {
    const errored = closeErrorSession();
    const at = errored.expiresAt as number;
    const result = expireSession(errored, expiryTiming(at));
    expect(result.transition).toBe("T9");
    expect(result.state.status).toBe("expirada");
  });

  it("error from T3 (start) is terminal and never expires via the worker", () => {
    const pending = createPendingSession(T0);
    const startError = applyCallback(pending, { idSesionAlumno: "A1", glosaError: "211" }, applyTiming(T0 + 1_000)).state;
    const result = expireSession(startError, expiryTiming(T0 + 10 * SESSION_MAX));
    expect(result.changed).toBe(false);
    expect(result.state.status).toBe("error");
  });
});

describe("I-15 — a late callback never revives a terminal session", () => {
  it("a close callback on an expirada session is late and does not change state", () => {
    const started = startedSession();
    const expired = expireSession(started, expiryTiming(started.expiresAt as number)).state;
    const result = applyCallback(
      expired,
      { idSesionAlumno: "A1", timestampMs: (started.expiresAt as number) + 60_000 },
      applyTiming((started.expiresAt as number) + 60_000),
    );
    expect(result.event?.late).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.transition).toBeNull();
    expect(result.state.status).toBe("expirada");
  });

  it("a callback on a cerrada session is late", () => {
    const started = startedSession();
    const closed = applyCallback(started, { idSesionAlumno: "A1", timestampMs: T0 + 9_000 }, applyTiming(T0 + 9_000)).state;
    const result = applyCallback(closed, { idSesionAlumno: "A1", glosaError: "300" }, applyTiming(T0 + 9_500));
    expect(result.event?.late).toBe(true);
    expect(result.state.status).toBe("cerrada");
  });

  it("a close callback arriving past expires_at on error(T7) is late (not T8)", () => {
    const errored = closeErrorSession();
    const past = (errored.expiresAt as number) + 1;
    const result = applyCallback(errored, { idSesionAlumno: "A1", timestampMs: past }, applyTiming(past));
    expect(result.event?.late).toBe(true);
    expect(result.transition).toBeNull();
    expect(result.state.status).toBe("error");
  });
});

describe("I-3 — idempotent replay", () => {
  it("re-applying the same start-success callback yields the same state and no second transition", () => {
    const pending = createPendingSession(T0);
    const cb: RawCallback = { idSesionAlumno: "A1", idSesionSence: "SENCE-1", timestampMs: T0 + 5_000 };
    const first = applyCallback(pending, cb, applyTiming(T0 + 5_000));
    expect(first.transition).toBe("T2");
    const second = applyCallback(first.state, cb, applyTiming(T0 + 5_500));
    expect(second.transition).toBeNull();
    expect(second.changed).toBe(false);
    expect(second.state).toEqual(first.state);
  });

  it("re-applying the same close-success callback does not re-close", () => {
    const started = startedSession();
    const cb: RawCallback = { idSesionAlumno: "A1", timestampMs: T0 + 9_000 };
    const first = applyCallback(started, cb, applyTiming(T0 + 9_000));
    expect(first.transition).toBe("T5");
    const second = applyCallback(first.state, cb, applyTiming(T0 + 9_100));
    expect(second.event?.late).toBe(true);
    expect(second.changed).toBe(false);
  });
});

describe("I-4 — callback discrimination", () => {
  it("unmatched: no correlated session → kind unmatched with a heuristic subtype", () => {
    const withSence = classifyCallback({ idSesionAlumno: "ZZ", idSesionSence: "S" }, null);
    expect(withSence.kind).toBe("unmatched");
    expect(withSence.heuristicSubtype).toBe("start");

    const withoutSence = classifyCallback({ idSesionAlumno: "ZZ" }, null);
    expect(withoutSence.kind).toBe("unmatched");
    expect(withoutSence.heuristicSubtype).toBe("close");
  });

  it("success class is decided by IdSesionSence presence", () => {
    const pending = createPendingSession(T0);
    expect(classifyCallback({ idSesionAlumno: "A1", idSesionSence: "S1" }, pending).kind).toBe("start_ok");
    const started = startedSession();
    expect(classifyCallback({ idSesionAlumno: "A1" }, started).kind).toBe("close_ok");
  });

  it("error subtype is decided by session STATE, not IdSesionSence", () => {
    const pending = createPendingSession(T0);
    const started = startedSession();
    const closeErr = closeErrorSession();
    expect(classifyCallback({ idSesionAlumno: "A1", glosaError: "204" }, pending).kind).toBe("start_error");
    expect(classifyCallback({ idSesionAlumno: "A1", glosaError: "300" }, started).kind).toBe("close_error");
    expect(classifyCallback({ idSesionAlumno: "A1", glosaError: "305" }, closeErr).kind).toBe("close_error");
  });

  it("empty GlosaError is treated as no error (I-4 'presente y no vacío')", () => {
    const started = startedSession();
    const cls = classifyCallback({ idSesionAlumno: "A1", glosaError: "   " }, started);
    expect(cls.kind).toBe("close_ok");
    expect(cls.errorCodes).toEqual([]);
  });

  it("a terminal-session error uses the IdSesionSence heuristic and is late (I-4/I-15)", () => {
    const started = startedSession();
    const closed = applyCallback(started, { idSesionAlumno: "A1", timestampMs: T0 + 9_000 }, applyTiming(T0 + 9_000)).state;
    const withSence = classifyCallback({ idSesionAlumno: "A1", glosaError: "211", idSesionSence: "S9" }, closed);
    expect(withSence.kind).toBe("start_error");
    expect(withSence.late).toBe(true);
    const withoutSence = classifyCallback({ idSesionAlumno: "A1", glosaError: "313" }, closed);
    expect(withoutSence.kind).toBe("close_error");
    expect(withoutSence.late).toBe(true);
  });
});

describe("I-5 — GlosaError parsed as a ;-separated list", () => {
  it("splits, trims and drops empties", () => {
    const pending = createPendingSession(T0);
    const cls = classifyCallback({ idSesionAlumno: "A1", glosaError: " 211 ; 204 ;; " }, pending);
    expect(cls.errorCodes).toEqual(["211", "204"]);
  });

  it("accepts a single code", () => {
    const pending = createPendingSession(T0);
    expect(classifyCallback({ idSesionAlumno: "A1", glosaError: "303" }, pending).errorCodes).toEqual(["303"]);
  });
});
