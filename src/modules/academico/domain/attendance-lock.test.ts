import { describe, expect, it } from "vitest";

import { computeLock } from "@/modules/academico/domain/attendance-lock";

const base = {
  exento: false,
  attendanceLock: true,
  sessionStatus: null,
  expiresAtMs: null,
  nowMs: 1_000_000,
} as const;

describe("computeLock (candado SENCE I-12/I-13/I-14)", () => {
  it("sin sesión: bloqueado, ofrece registrar", () => {
    const s = computeLock({ ...base });
    expect(s.unlocked).toBe(false);
    expect(s.action).toBe("register");
  });

  it("exento: siempre desbloqueado, sin acción (I-14)", () => {
    const s = computeLock({ ...base, exento: true });
    expect(s.unlocked).toBe(true);
    expect(s.action).toBe("none");
  });

  it("acción sin candado: desbloqueado", () => {
    const s = computeLock({ ...base, attendanceLock: false });
    expect(s.unlocked).toBe(true);
  });

  it("iniciada_pendiente: bloqueado, esperando", () => {
    const s = computeLock({ ...base, sessionStatus: "iniciada_pendiente" });
    expect(s.unlocked).toBe(false);
    expect(s.action).toBe("waiting");
  });

  it("iniciada y vigente: desbloqueado, ofrece cerrar, con tiempo restante", () => {
    const s = computeLock({
      ...base,
      sessionStatus: "iniciada",
      expiresAtMs: base.nowMs + 3_600_000,
    });
    expect(s.unlocked).toBe(true);
    expect(s.action).toBe("close");
    expect(s.remainingMs).toBe(3_600_000);
  });

  it("iniciada pero expirada de facto: re-bloquea", () => {
    const s = computeLock({
      ...base,
      sessionStatus: "iniciada",
      expiresAtMs: base.nowMs - 1,
    });
    expect(s.unlocked).toBe(false);
    expect(s.action).toBe("register");
  });

  it("cerrada / expirada: bloqueado, debe re-registrar", () => {
    for (const status of ["cerrada", "expirada"] as const) {
      const s = computeLock({ ...base, sessionStatus: status });
      expect(s.unlocked, status).toBe(false);
      expect(s.action, status).toBe("register");
    }
  });

  it("error de INICIO (T3): terminal, debe re-registrar desde cero", () => {
    const s = computeLock({ ...base, sessionStatus: "error", errorOrigin: "start" });
    expect(s.unlocked).toBe(false);
    expect(s.action).toBe("register");
  });

  it("error de CIERRE (T7) VIGENTE: ofrece REINTENTAR el cierre (T8, D-048/Q-05)", () => {
    const s = computeLock({
      ...base,
      sessionStatus: "error",
      errorOrigin: "close",
      expiresAtMs: base.nowMs + 3_600_000,
    });
    expect(s.unlocked).toBe(false);
    expect(s.action).toBe("close");
  });

  it("error de CIERRE ya VENCIDO (expires_at pasado): el reintento sería fútil → re-registrar", () => {
    const s = computeLock({
      ...base,
      sessionStatus: "error",
      errorOrigin: "close",
      expiresAtMs: base.nowMs - 1,
    });
    expect(s.action).toBe("register");
  });

  it("error sin origen conocido: por defecto re-registrar", () => {
    const s = computeLock({ ...base, sessionStatus: "error" });
    expect(s.action).toBe("register");
  });
});
