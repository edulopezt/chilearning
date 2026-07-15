import { describe, expect, it } from "vitest";

import { errorRateAlertMessage, evaluateErrorRate } from "./alerts";

const POLICY = { threshold: 0.2, minEvents: 5 };

describe("evaluateErrorRate (task 2.6 — política de alerta)", () => {
  it("alerta en el borde exacto: rate === threshold (borde INCLUSIVO)", () => {
    const verdict = evaluateErrorRate({ errors: 1, total: 5 }, POLICY);
    expect(verdict.rate).toBe(0.2);
    expect(verdict.alert).toBe(true);
  });

  it("NO alerta bajo el mínimo de eventos aunque sea 100% error (anti-ruido)", () => {
    const verdict = evaluateErrorRate({ errors: 4, total: 4 }, POLICY);
    expect(verdict.rate).toBe(1);
    expect(verdict.alert).toBe(false);
  });

  it("NO alerta con 0 eventos (rate 0, sin división por cero)", () => {
    const verdict = evaluateErrorRate({ errors: 0, total: 0 }, POLICY);
    expect(verdict.rate).toBe(0);
    expect(verdict.alert).toBe(false);
  });

  it("NO alerta bajo el umbral con volumen suficiente", () => {
    const verdict = evaluateErrorRate({ errors: 1, total: 10 }, POLICY);
    expect(verdict.alert).toBe(false);
  });

  it("alerta sobre el umbral con volumen suficiente", () => {
    const verdict = evaluateErrorRate({ errors: 6, total: 10 }, POLICY);
    expect(verdict.alert).toBe(true);
    expect(verdict.rate).toBe(0.6);
  });
});

describe("errorRateAlertMessage", () => {
  it("compone el mensaje es-CL con porcentaje, ventana y ambiente (R-2)", () => {
    const sample = { errors: 2, total: 6 };
    const message = errorRateAlertMessage(evaluateErrorRate(sample, POLICY), sample, 60, "rce");
    expect(message).toContain("producción (rce)");
    expect(message).toContain("33%");
    expect(message).toContain("2 de 6");
    expect(message).toContain("60 minutos");
    expect(message.length).toBeLessThanOrEqual(500); // check de la columna
  });

  it("etiqueta rcetest como pruebas (los ambientes no se confunden)", () => {
    const sample = { errors: 5, total: 5 };
    const message = errorRateAlertMessage(evaluateErrorRate(sample, POLICY), sample, 30, "rcetest");
    expect(message).toContain("pruebas (rcetest)");
  });
});
