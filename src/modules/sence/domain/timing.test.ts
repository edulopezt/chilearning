import { describe, expect, it } from "vitest";

import { SENCE_TIMING_DEFAULTS, senceTimingFromEnv } from "./timing";

describe("senceTimingFromEnv (I-13/D-003 — knobs con default seguro)", () => {
  it("sin env: defaults del contrato (3 h / 15 min / 20% / 5 eventos / tick 5 min)", () => {
    const t = senceTimingFromEnv({});
    expect(t.pendingTimeoutMs).toBe(15 * 60_000); // D-048/Q-04: default 15 min (antes 60)
    expect(t.sessionMaxMs).toBe(3 * 3_600_000);
    expect(t.alertWindowMs).toBe(60 * 60_000);
    expect(t.alertErrorRateThreshold).toBe(SENCE_TIMING_DEFAULTS.alertErrorRateThreshold);
    expect(t.alertMinEvents).toBe(5);
    expect(t.tickEveryMs).toBe(5 * 60_000);
    expect(t.invalidKeys).toEqual([]);
  });

  it("SENCE_TICK_EVERY_MS: válido se respeta; negativo/fraccionario cae al default (R-3)", () => {
    expect(senceTimingFromEnv({ SENCE_TICK_EVERY_MS: "60000" }).tickEveryMs).toBe(60_000);
    for (const raw of ["-300000", "0.5", "0", "cinco"]) {
      const t = senceTimingFromEnv({ SENCE_TICK_EVERY_MS: raw });
      expect(t.tickEveryMs).toBe(5 * 60_000);
      expect(t.invalidKeys).toContain("SENCE_TICK_EVERY_MS");
    }
  });

  it("valores válidos se respetan", () => {
    const t = senceTimingFromEnv({
      SENCE_PENDING_TIMEOUT_MINUTES: "30",
      SENCE_SESSION_MAX_HOURS: "2",
      SENCE_ALERT_WINDOW_MINUTES: "15",
      SENCE_ALERT_ERROR_RATE_THRESHOLD: "0.5",
      SENCE_ALERT_MIN_EVENTS: "10",
    });
    expect(t.pendingTimeoutMs).toBe(30 * 60_000);
    expect(t.sessionMaxMs).toBe(2 * 3_600_000);
    expect(t.alertWindowMs).toBe(15 * 60_000);
    expect(t.alertErrorRateThreshold).toBe(0.5);
    expect(t.alertMinEvents).toBe(10);
    expect(t.invalidKeys).toEqual([]);
  });

  it("valor no numérico, negativo, cero o fraccionario cae al default y se reporta", () => {
    const t = senceTimingFromEnv({
      SENCE_PENDING_TIMEOUT_MINUTES: "abc",
      SENCE_SESSION_MAX_HOURS: "-1",
      SENCE_ALERT_WINDOW_MINUTES: "0",
      SENCE_ALERT_MIN_EVENTS: "2.5",
    });
    expect(t.pendingTimeoutMs).toBe(15 * 60_000); // D-048/Q-04: default 15 min (antes 60)
    expect(t.sessionMaxMs).toBe(3 * 3_600_000);
    expect(t.alertWindowMs).toBe(60 * 60_000);
    expect(t.alertMinEvents).toBe(5);
    expect(t.invalidKeys).toEqual([
      "SENCE_PENDING_TIMEOUT_MINUTES",
      "SENCE_SESSION_MAX_HOURS",
      "SENCE_ALERT_WINDOW_MINUTES",
      "SENCE_ALERT_MIN_EVENTS",
    ]);
  });

  it("umbral fuera de (0, 1] cae al default y se reporta", () => {
    for (const raw of ["0", "-0.2", "1.5", "nope"]) {
      const t = senceTimingFromEnv({ SENCE_ALERT_ERROR_RATE_THRESHOLD: raw });
      expect(t.alertErrorRateThreshold).toBe(SENCE_TIMING_DEFAULTS.alertErrorRateThreshold);
      expect(t.invalidKeys).toContain("SENCE_ALERT_ERROR_RATE_THRESHOLD");
    }
    // 1 es válido (100%): borde superior inclusivo.
    const edge = senceTimingFromEnv({ SENCE_ALERT_ERROR_RATE_THRESHOLD: "1" });
    expect(edge.alertErrorRateThreshold).toBe(1);
    expect(edge.invalidKeys).toEqual([]);
  });

  it("string vacío cuenta como ausente (default sin reporte)", () => {
    const t = senceTimingFromEnv({ SENCE_SESSION_MAX_HOURS: " " });
    expect(t.sessionMaxMs).toBe(3 * 3_600_000);
    expect(t.invalidKeys).toEqual([]);
  });

  it("knobs de día-1 (task 2.7): defaults, válidos y hora fuera de rango", () => {
    const d = senceTimingFromEnv({});
    expect(d.day1AttendanceThreshold).toBe(0.5);
    expect(d.day1EvalHour).toBe(13);

    const custom = senceTimingFromEnv({
      SENCE_DAY1_ATTENDANCE_THRESHOLD: "0.75",
      SENCE_DAY1_EVAL_HOUR: "9",
    });
    expect(custom.day1AttendanceThreshold).toBe(0.75);
    expect(custom.day1EvalHour).toBe(9);

    const invalid = senceTimingFromEnv({ SENCE_DAY1_EVAL_HOUR: "24" });
    expect(invalid.day1EvalHour).toBe(13);
    expect(invalid.invalidKeys).toContain("SENCE_DAY1_EVAL_HOUR");
  });
});
