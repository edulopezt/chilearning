import { describe, expect, it } from "vitest";

import { day1AlertMessage, evaluateDay1, localHour, localIsoDate } from "./day1";

describe("evaluateDay1 (task 2.7 — alerta temprana del día 1)", () => {
  it("alerta bajo el umbral", () => {
    const v = evaluateDay1({ enrolledNonExempt: 10, withSessionToday: 3 }, 0.5);
    expect(v).toEqual({ alert: true, ratio: 0.3 });
  });

  it("NO alerta en el borde exacto (ratio === threshold, borde EXCLUSIVO)", () => {
    const v = evaluateDay1({ enrolledNonExempt: 10, withSessionToday: 5 }, 0.5);
    expect(v.alert).toBe(false);
    expect(v.ratio).toBe(0.5);
  });

  it("NO alerta sobre el umbral ni con 0 inscritos no exentos", () => {
    expect(evaluateDay1({ enrolledNonExempt: 4, withSessionToday: 4 }, 0.5).alert).toBe(false);
    expect(evaluateDay1({ enrolledNonExempt: 0, withSessionToday: 0 }, 0.5)).toEqual({
      alert: false,
      ratio: 1,
    });
  });

  it("el mensaje es-CL trae código de acción y conteos, sin datos personales", () => {
    const sample = { enrolledNonExempt: 8, withSessionToday: 2 };
    const msg = day1AlertMessage(evaluateDay1(sample, 0.5), sample, "ACC-2026-001");
    expect(msg).toContain("ACC-2026-001");
    expect(msg).toContain("2 de 8");
    expect(msg).toContain("25%");
    expect(msg.length).toBeLessThanOrEqual(500);
  });
});

describe("helpers de zona horaria (sin dependencias)", () => {
  // 2026-07-15T18:30:00Z = 14:30 en Chile continental (invierno, UTC-4).
  const T = Date.parse("2026-07-15T18:30:00Z");

  it("localIsoDate devuelve la fecha LOCAL de Santiago", () => {
    expect(localIsoDate(T, "America/Santiago")).toBe("2026-07-15");
    // 2026-07-16T02:00:00Z todavía es 15 de julio en Santiago (22:00).
    expect(localIsoDate(Date.parse("2026-07-16T02:00:00Z"), "America/Santiago")).toBe(
      "2026-07-15",
    );
  });

  it("localHour devuelve la hora LOCAL 0-23", () => {
    expect(localHour(T, "America/Santiago")).toBe(14);
    // Medianoche local: 04:05Z del 16 = 00:05 del 16 en Santiago.
    expect(localHour(Date.parse("2026-07-16T04:05:00Z"), "America/Santiago")).toBe(0);
  });
});
