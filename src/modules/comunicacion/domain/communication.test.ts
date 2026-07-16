import { describe, expect, it } from "vitest";

import {
  mergeCalendar,
  parseAnnouncementInput,
  parseCalendarItemInput,
  parseMessageInput,
  responseAge,
  SLA_THRESHOLDS_HOURS,
} from "./communication";

const H = 3_600_000;

describe("parseAnnouncementInput", () => {
  it("acepta con un target y rechaza sin target", () => {
    expect(parseAnnouncementInput({ title: "Aviso", body: "Cuerpo", courseId: "c1" }).ok).toBe(true);
    const none = parseAnnouncementInput({ title: "Aviso", body: "Cuerpo" });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.errors.some((e) => e.field === "target")).toBe(true);
  });
  it("rechaza título/cuerpo vacíos", () => {
    expect(parseAnnouncementInput({ title: "", body: "", courseId: "c1" }).ok).toBe(false);
  });
});

describe("parseCalendarItemInput", () => {
  it("normaliza la fecha a ISO", () => {
    const r = parseCalendarItemInput({ kind: "plazo", title: "Entrega", dueAt: "2026-07-20T10:00" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.dueAtISO).toContain("2026-07-20");
  });
  it("rechaza fecha inválida y tipo inválido", () => {
    expect(parseCalendarItemInput({ kind: "x", title: "t", dueAt: "no" }).ok).toBe(false);
  });
});

describe("parseMessageInput", () => {
  it("exige asunto y cuerpo", () => {
    expect(parseMessageInput({ subject: "Consulta", body: "Hola" }).ok).toBe(true);
    expect(parseMessageInput({ subject: "", body: "" }).ok).toBe(false);
  });
});

describe("responseAge (SLA)", () => {
  const now = 100 * H;
  it("respondida cuando el último mensaje es del staff", () => {
    const r = responseAge([{ atMs: 10 * H, fromStaff: false }, { atMs: 12 * H, fromStaff: true }], now);
    expect(r.sla).toBe("answered");
    expect(r.pendingSinceMs).toBeNull();
  });
  it("verde/ámbar/rojo según el tiempo pendiente", () => {
    expect(responseAge([{ atMs: now - 1 * H, fromStaff: false }], now).sla).toBe("green");
    expect(responseAge([{ atMs: now - (SLA_THRESHOLDS_HOURS.amber + 1) * H, fromStaff: false }], now).sla).toBe("amber");
    expect(responseAge([{ atMs: now - (SLA_THRESHOLDS_HOURS.red + 1) * H, fromStaff: false }], now).sla).toBe("red");
  });
  it("cuenta desde la primera consulta sin responder tras el último staff", () => {
    const r = responseAge(
      [
        { atMs: 10 * H, fromStaff: false },
        { atMs: 12 * H, fromStaff: true },
        { atMs: 20 * H, fromStaff: false },
        { atMs: 22 * H, fromStaff: false },
      ],
      now,
    );
    expect(r.pendingSinceMs).toBe(20 * H);
  });
});

describe("mergeCalendar", () => {
  it("une manual + instrumentos ordenado por fecha", () => {
    const merged = mergeCalendar(
      [{ kind: "hito", title: "Inicio", dueAtMs: 5 * H }],
      [{ kind: "evaluacion", title: "Quiz", dueAtMs: 2 * H }],
    );
    expect(merged.map((m) => m.title)).toEqual(["Quiz", "Inicio"]);
    expect(merged[0]!.source).toBe("instrument");
  });
});
