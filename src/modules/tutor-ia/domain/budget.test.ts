import { describe, expect, it } from "vitest";

import { checkTutorBudget } from "./budget";

const BASE = { messagesToday: 0, dailyLimit: 5, tenantTokensThisMonth: 0, monthlyBudget: 1_000_000 };

describe("checkTutorBudget (HU-11.2, puro)", () => {
  it("exactamente en el límite diario → bloquea (no deja pasar el N+1)", () => {
    expect(checkTutorBudget({ ...BASE, messagesToday: 5 })).toEqual({ allowed: false, reason: "daily_limit" });
  });

  it("un tick por debajo del límite diario → permite", () => {
    expect(checkTutorBudget({ ...BASE, messagesToday: 4 })).toEqual({ allowed: true, reason: null });
  });

  it("un tick por encima → sigue bloqueado (no es solo el borde exacto)", () => {
    expect(checkTutorBudget({ ...BASE, messagesToday: 6 })).toEqual({ allowed: false, reason: "daily_limit" });
  });

  it("presupuesto del tenant agotado con margen diario intacto → bloquea igual", () => {
    expect(
      checkTutorBudget({ ...BASE, messagesToday: 0, tenantTokensThisMonth: 1_000_000, monthlyBudget: 1_000_000 }),
    ).toEqual({ allowed: false, reason: "tenant_budget" });
  });

  it("presupuesto del tenant con margen exacto por debajo del tope → permite", () => {
    expect(
      checkTutorBudget({ ...BASE, messagesToday: 0, tenantTokensThisMonth: 999_999, monthlyBudget: 1_000_000 }),
    ).toEqual({ allowed: true, reason: null });
  });

  it("ambos límites agotados a la vez → reporta tenant_budget (el corte de plataforma manda)", () => {
    expect(
      checkTutorBudget({ messagesToday: 5, dailyLimit: 5, tenantTokensThisMonth: 1_000_000, monthlyBudget: 1_000_000 }),
    ).toEqual({ allowed: false, reason: "tenant_budget" });
  });

  it("dentro de ambos límites → permite", () => {
    expect(checkTutorBudget(BASE)).toEqual({ allowed: true, reason: null });
  });
});
