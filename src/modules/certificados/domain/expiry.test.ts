import { describe, expect, it } from "vitest";

import {
  buildExpiryN8nEvent,
  computeExpiresAt,
  DEFAULT_EXPIRY_OFFSETS,
  daysUntil,
  dueOffset,
  offsetsToMark,
  sanitizeOffsets,
} from "@/modules/certificados/domain/expiry";

/**
 * Unit del dominio de vigencia (task 5.12, HU-7.3). Lo que se fija aquí:
 * el clamp de fin de mes (incluidos bisiestos), la regla anti-ráfaga de
 * `dueOffset` y el boundary RNF-10 del evento a n8n.
 */

const OFFSETS = [90, 60, 30];

describe("computeExpiresAt — suma de meses con clamp de fin de mes", () => {
  it("caso normal: 12 meses = mismo día del año siguiente", () => {
    expect(computeExpiresAt("2026-07-17T12:00:00.000Z", 12)).toBe("2027-07-17T12:00:00.000Z");
  });

  it("★ 31-ene + 1 mes = 28-feb (año NO bisiesto), no 3-mar", () => {
    // El defecto que este clamp evita: `setUTCMonth(+1)` sobre el 31 de enero
    // devuelve el 3 de marzo, porque febrero no tiene 31 días y Date desborda.
    expect(computeExpiresAt("2026-01-31T00:00:00.000Z", 1)).toBe("2026-02-28T00:00:00.000Z");
  });

  it("★ 31-ene + 1 mes = 29-feb en año BISIESTO", () => {
    expect(computeExpiresAt("2028-01-31T00:00:00.000Z", 1)).toBe("2028-02-29T00:00:00.000Z");
  });

  it("★ 29-feb (bisiesto) + 12 meses = 28-feb del año siguiente", () => {
    // El caso clásico al revés: el día 29 no existe en el año destino.
    expect(computeExpiresAt("2028-02-29T00:00:00.000Z", 12)).toBe("2029-02-28T00:00:00.000Z");
  });

  it("29-feb + 48 meses cae en otro bisiesto y CONSERVA el 29", () => {
    expect(computeExpiresAt("2028-02-29T00:00:00.000Z", 48)).toBe("2032-02-29T00:00:00.000Z");
  });

  it("31-mar + 1 mes = 30-abr (mes de 30 días)", () => {
    expect(computeExpiresAt("2026-03-31T00:00:00.000Z", 1)).toBe("2026-04-30T00:00:00.000Z");
  });

  it("31-dic + 2 meses = 28-feb (cruza el año y clampea)", () => {
    expect(computeExpiresAt("2026-12-31T00:00:00.000Z", 2)).toBe("2027-02-28T00:00:00.000Z");
  });

  it("conserva la hora exacta de emisión (la vigencia no reinicia el reloj)", () => {
    expect(computeExpiresAt("2026-05-15T18:45:30.123Z", 24)).toBe("2028-05-15T18:45:30.123Z");
  });

  it("null / 0 / negativo / no entero ⇒ null (falla cerrado: no inventa vencimientos)", () => {
    const iso = "2026-07-17T12:00:00.000Z";
    expect(computeExpiresAt(iso, null)).toBeNull();
    expect(computeExpiresAt(iso, 0)).toBeNull();
    expect(computeExpiresAt(iso, -3)).toBeNull();
    expect(computeExpiresAt(iso, 1.5)).toBeNull();
    expect(computeExpiresAt(iso, Number.NaN)).toBeNull();
  });

  it("fecha de emisión inválida ⇒ null (no revienta el flujo de emisión)", () => {
    expect(computeExpiresAt("no-es-fecha", 12)).toBeNull();
  });
});

describe("daysUntil", () => {
  const now = Date.parse("2026-07-17T00:00:00.000Z");
  it("cuenta días de calendario y admite negativos (ya vencido)", () => {
    expect(daysUntil("2026-10-15T00:00:00.000Z", now)).toBe(90);
    expect(daysUntil("2026-07-17T00:00:00.000Z", now)).toBe(0);
    expect(daysUntil("2026-07-16T00:00:00.000Z", now)).toBe(-1);
  });
  it("trunca hacia abajo: 89 d y 23 h son 89 días, no 90", () => {
    expect(daysUntil("2026-10-14T23:00:00.000Z", now)).toBe(89);
  });
});

describe("dueOffset — el MENOR offset alcanzado (anti-ráfaga)", () => {
  const now = Date.parse("2026-07-17T00:00:00.000Z");
  const at = (days: number): string => new Date(now + days * 24 * 60 * 60 * 1000).toISOString();

  it("91 días ⇒ null (aún fuera de la ventana)", () => {
    expect(dueOffset(at(91), now, OFFSETS)).toBeNull();
  });

  it("90 días ⇒ 90 (el borde entra)", () => {
    expect(dueOffset(at(90), now, OFFSETS)).toBe(90);
  });

  it("60 días ⇒ 60, 29 días ⇒ 30, 0 días ⇒ 30 (vence hoy)", () => {
    expect(dueOffset(at(60), now, OFFSETS)).toBe(60);
    expect(dueOffset(at(29), now, OFFSETS)).toBe(30);
    expect(dueOffset(at(0), now, OFFSETS)).toBe(30);
  });

  it("★ 45 días ⇒ 60, NO 90: entra tarde a la ventana y se avisa el menor pendiente", () => {
    // La regla anti-ráfaga. Con "el mayor alcanzado" esto daría 90 y el tick
    // siguiente 60 y luego 30: tres correos por un hecho único.
    expect(dueOffset(at(45), now, OFFSETS)).toBe(60);
  });

  it("★ -1 día (ya vencido) ⇒ null: no se spamea a quien ya perdió la vigencia", () => {
    expect(dueOffset(at(-1), now, OFFSETS)).toBeNull();
    expect(dueOffset(at(-400), now, OFFSETS)).toBeNull();
  });

  it("fecha inválida ⇒ null", () => {
    expect(dueOffset("basura", now, OFFSETS)).toBeNull();
  });

  it("offsets custom de un solo valor funcionan igual", () => {
    expect(dueOffset(at(10), now, [15])).toBe(15);
    expect(dueOffset(at(20), now, [15])).toBeNull();
  });
});

describe("offsetsToMark — el due y todos los mayores", () => {
  it("al notificar 60, marca {90, 60}: el 90 ya no corresponde", () => {
    expect(offsetsToMark(60, OFFSETS)).toEqual([90, 60]);
  });
  it("al notificar 90 marca solo {90}; al notificar 30 marca todos", () => {
    expect(offsetsToMark(90, OFFSETS)).toEqual([90]);
    expect(offsetsToMark(30, OFFSETS)).toEqual([90, 60, 30]);
  });
});

describe("sanitizeOffsets", () => {
  it("ordena descendente y deduplica", () => {
    expect(sanitizeOffsets([30, 90, 60, 30])).toEqual([90, 60, 30]);
  });
  it("descarta fuera de rango, no enteros y basura", () => {
    expect(sanitizeOffsets([0, 366, 45, -5, 12.5, "abc", null, 30])).toEqual([45, 30]);
  });
  it("acepta numéricos en texto (vienen de un form)", () => {
    expect(sanitizeOffsets(["90", "30"])).toEqual([90, 30]);
  });
  it("★ entrada vacía / no-array / toda inválida ⇒ default 90/60/30 (nunca silencio)", () => {
    // Una config rota NO puede apagar los avisos de recertificación.
    expect(sanitizeOffsets([])).toEqual([...DEFAULT_EXPIRY_OFFSETS]);
    expect(sanitizeOffsets(null)).toEqual([...DEFAULT_EXPIRY_OFFSETS]);
    expect(sanitizeOffsets("90,60")).toEqual([...DEFAULT_EXPIRY_OFFSETS]);
    expect(sanitizeOffsets([0, 999])).toEqual([...DEFAULT_EXPIRY_OFFSETS]);
  });
  it("respeta el borde 1..365", () => {
    expect(sanitizeOffsets([1, 365])).toEqual([365, 1]);
  });
});

describe("buildExpiryN8nEvent — boundary RNF-10", () => {
  const SECRET = "secreto-de-prueba";
  const TENANT = "11111111-1111-4111-8111-111111111111";
  const COURSE = "c0ffee00-0000-4000-8000-000000000001";

  it("★ solo lleva las claves del agregado: cero PII posible", () => {
    const event = buildExpiryN8nEvent(SECRET, {
      tenantId: TENANT, courseId: COURSE, offsetDays: 30, count: 4, at: "2026-07-17T00:00:00.000Z",
    });
    // Se afirma la lista EXACTA: si alguien agrega `studentName` al evento, este
    // test cae. Es la red que hace verdadero "a n8n nunca va PII".
    expect(Object.keys(event).sort()).toEqual(["at", "count", "course", "offsetDays", "tenant", "type"]);
    expect(event.count).toBe(4);
    expect(event.offsetDays).toBe(30);
  });

  it("★ los ids reales no aparecen: van seudonimizados (no reversibles)", () => {
    const json = JSON.stringify(buildExpiryN8nEvent(SECRET, {
      tenantId: TENANT, courseId: COURSE, offsetDays: 90, count: 1, at: "2026-07-17T00:00:00.000Z",
    }));
    expect(json).not.toContain(TENANT);
    expect(json).not.toContain(COURSE);
  });

  it("el seudónimo es determinista por secreto y distinto entre tenants", () => {
    const mk = (tenantId: string, secret = SECRET): string =>
      buildExpiryN8nEvent(secret, { tenantId, courseId: COURSE, offsetDays: 30, count: 1, at: "x" }).course;
    // Mismo curso, distinto tenant ⇒ distinto seudónimo (no se correlaciona entre OTECs).
    expect(mk(TENANT)).toBe(mk(TENANT));
    expect(mk("22222222-2222-4222-8222-222222222222")).not.toBe(mk(TENANT));
    expect(mk(TENANT, "otro-secreto")).not.toBe(mk(TENANT));
  });
});
