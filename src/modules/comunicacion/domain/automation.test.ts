import { describe, expect, it } from "vitest";

import { buildN8nEvent, pseudonymize, signWebhook, verifyWebhook } from "./automation";
import {
  coordinatorReport,
  reminderKey,
  selectInactive,
  selectNoAttendance,
  type ReminderEnrollment,
} from "./reminders-rules";

const SECRET = "test-secret-1234567890";
const RUN = "5126663-3";
const EMAIL = "ana.perez@otec.cl";
const NAME = "Ana Pérez";

describe("seudónimo y firma HMAC", () => {
  it("el seudónimo es determinista, opaco y no contiene el id real", () => {
    const a = pseudonymize(SECRET, "t1", "u1");
    const b = pseudonymize(SECRET, "t1", "u1");
    expect(a).toBe(b);
    expect(a).not.toContain("u1");
    expect(a).toHaveLength(32);
    // Distinto secreto o input → distinto seudónimo.
    expect(pseudonymize("otro", "t1", "u1")).not.toBe(a);
    expect(pseudonymize(SECRET, "t1", "u2")).not.toBe(a);
  });

  it("la firma es estable y detecta manipulación", () => {
    const body = JSON.stringify({ x: 1 });
    const sig = signWebhook(SECRET, body);
    expect(verifyWebhook(SECRET, body, sig)).toBe(true);
    expect(verifyWebhook(SECRET, body, sig + "0")).toBe(false);
    expect(verifyWebhook(SECRET, JSON.stringify({ x: 2 }), sig)).toBe(false);
    expect(verifyWebhook("otro", body, sig)).toBe(false);
  });
});

describe("RNF-10: el evento a n8n JAMÁS lleva PII", () => {
  it("solo seudónimos + conteos; ni RUN, ni correo, ni nombre", () => {
    const event = buildN8nEvent(SECRET, {
      kind: "no_attendance",
      tenantId: "11111111-1111-4111-8111-111111111111",
      actionId: "ac000000-0000-4000-8000-000000000001",
      recipientUserIds: ["user-a", "user-b"],
      at: "2026-07-16T12:00:00.000Z",
    });
    const json = JSON.stringify(event);
    expect(json).not.toContain(RUN);
    expect(json).not.toContain(EMAIL);
    expect(json).not.toContain(NAME);
    expect(json).not.toContain("user-a"); // ni siquiera el user_id crudo
    expect(event.count).toBe(2);
    expect(event.recipients).toHaveLength(2);
    expect(event.recipients[0]).toHaveLength(32);
  });
});

describe("reglas de recordatorio", () => {
  const base: ReminderEnrollment = { enrollmentId: "e", userId: "u", exento: false, attendedToday: false, lastActivityDaysAgo: 0, optedOut: false };
  const enrollments: ReminderEnrollment[] = [
    { ...base, enrollmentId: "e1", userId: "u1", attendedToday: false, lastActivityDaysAgo: 10 },
    { ...base, enrollmentId: "e2", userId: "u2", attendedToday: true, lastActivityDaysAgo: 0 },
    { ...base, enrollmentId: "e3", userId: "u3", exento: true, attendedToday: false }, // exento: excluido
    { ...base, enrollmentId: "e4", userId: "u4", attendedToday: false, optedOut: true }, // opt-out: excluido
    { ...base, enrollmentId: "e5", userId: "u5", attendedToday: false, lastActivityDaysAgo: null }, // nunca ingresó
  ];

  it("sin asistencia: excluye exentos, opt-out y ya-recordados", () => {
    const sent = new Set([reminderKey("no_attendance", "u1")]);
    const targets = selectNoAttendance(enrollments, sent).map((t) => t.userId);
    expect(targets).toEqual(["u5"]); // u1 ya recordado, u2 asistió, u3 exento, u4 opt-out
  });

  it("inactivos ≥ umbral (o nunca ingresó)", () => {
    const targets = selectInactive(enrollments, 7, new Set()).map((t) => t.userId);
    expect(targets).toContain("u1"); // 10 >= 7
    expect(targets).toContain("u5"); // null = nunca
    expect(targets).not.toContain("u2"); // 0 días
    expect(targets).not.toContain("u4"); // opt-out
  });

  it("informe al coordinador: agregado sin PII", () => {
    const r = coordinatorReport(enrollments, 7);
    expect(r.total).toBe(4); // excluye el exento
    expect(r.withoutAttendanceToday).toBe(3); // u1, u4, u5 (u2 asistió)
    expect(r.inactive).toBe(2); // u1(10), u5(null)
  });
});
