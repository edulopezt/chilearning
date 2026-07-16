import { describe, expect, it } from "vitest";

import { djRosterRow, DJ_ROSTER_HEADERS } from "./roster";
import { applyTransition, canTransition, isOverdue, settlementDeadline } from "./state-machine";

describe("máquina de estados DJ", () => {
  it("acepta transiciones legales y rechaza ilegales", () => {
    expect(canTransition("pendiente_emitir", "pendiente_validacion")).toBe(true);
    expect(canTransition("pendiente_emitir", "emitida")).toBe(true);
    expect(canTransition("emitida", "aprobado_reemision")).toBe(true);
    // anulada es terminal.
    expect(canTransition("anulada", "emitida")).toBe(false);
    // ilegal: no se puede saltar de pendiente_emitir a aprobado_reemision.
    expect(canTransition("pendiente_emitir", "aprobado_reemision")).toBe(false);
  });

  it("applyTransition no cambia el estado en una transición ilegal", () => {
    expect(applyTransition("emitida", "pendiente_emitir")).toEqual({ changed: false, next: "emitida" });
    expect(applyTransition("pendiente_emitir", "emitida")).toEqual({ changed: true, next: "emitida" });
  });
});

describe("liquidación 60 días", () => {
  it("calcula la fecha límite y detecta vencimiento", () => {
    expect(settlementDeadline("2026-07-01")).toBe("2026-08-30");
    expect(settlementDeadline(null)).toBeNull();
    expect(isOverdue("2026-08-30", "2026-09-01")).toBe(true);
    expect(isOverdue("2026-08-30", "2026-08-15")).toBe(false);
    expect(isOverdue(null, "2026-09-01")).toBe(false);
  });
});

describe("nómina", () => {
  it("arma una fila por participante con estado legible", () => {
    expect(DJ_ROSTER_HEADERS.length).toBe(7);
    const row = djRosterRow({ nombres: "Ana", apellidos: "Díaz", run: "5126663-3", state: "emitida", settlementDeadline: "2026-08-30", overdue: false, updatedAt: "2026-07-16" });
    expect(row[3]).toBe("Emitida");
    expect(row[5]).toBe("No");
  });
});
