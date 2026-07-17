/**
 * Integración del sincrónico en vivo (task 5.4, spec §7-R3) contra Supabase
 * local: permisos, la ventana exacta de auto-marca, la regla "manual gana",
 * el cruce de acción en `markAttendance`, el borrado gateado por asistencia y
 * el export CSV con el disclaimer. Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "@/modules/core/domain/rbac";
import {
  attendanceForSession,
  createLiveSession,
  deleteLiveSession,
  exportAttendanceCsv,
  listMySessions,
  listSessionsByAction,
  markAttendance,
  rosterForSession,
  selfMarkAttendance,
  updateLiveSession,
} from "@/modules/academico/live-session-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const COURSE_A = "c0000000-0000-4000-8000-000000000001";
const ACTION_A1 = "ac000000-0000-4000-8000-000000000001"; // acción demo sembrada
const ENROLLMENT_STUDENT_A1 = "e0000000-0000-4000-8000-000000000001"; // María José Pérez Soto
const ENROLLMENT_RODRIGO_A1 = "e0000000-0000-4000-8000-000000000002"; // Rodrigo Fuentes Lagos

const adminA: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };
const studentA: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000005", tenantId: TENANT_A, roles: ["student"] };
const notEnrolledA: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000006", tenantId: TENANT_A, roles: ["company"] };
const adminB: Principal = { userId: "bbbbbbbb-0000-4000-8000-000000000001", tenantId: TENANT_B, roles: ["otec_admin"] };

const OTHER_ACTION_ID = randomUUID(); // acción distinta, para el cruce de markAttendance
const OTHER_ENROLLMENT_ID = randomUUID(); // inscrito de OTHER_ACTION_ID, no de ACTION_A1

let svc: SupabaseClient;
const createdSessionIds: string[] = [];

/** Ventana relativa a AHORA (para no depender de fechas fijas de fixture). */
function window(offsetMinutesStart: number, offsetMinutesEnd: number): { startsAt: string; endsAt: string } {
  const now = Date.now();
  return {
    startsAt: new Date(now + offsetMinutesStart * 60_000).toISOString(),
    endsAt: new Date(now + offsetMinutesEnd * 60_000).toISOString(),
  };
}

/** Sesión "futura lejana": fuera de la ventana de auto-marca (empieza en 1h). */
function farFutureRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Clase en vivo — integración",
    provider: "zoom",
    meetingUrl: "https://zoom.us/j/999999999",
    ...window(60, 120),
    details: "Detalles de prueba",
    ...overrides,
  };
}

/** Sesión "en curso": empezó hace 5 min, termina en 55 min (dentro de la ventana). */
function inProgressRaw(): Record<string, unknown> {
  return farFutureRaw(window(-5, 55));
}

beforeAll(async () => {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  process.env.NEXT_PUBLIC_SUPABASE_URL = get("API_URL");
  process.env.SUPABASE_SERVICE_ROLE_KEY = get("SERVICE_ROLE_KEY");
  svc = createClient(get("API_URL"), get("SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  // Acción + inscripción DISTINTA de ACTION_A1, para el cruce de markAttendance.
  const actionIns = await svc.from("actions").insert({
    id: OTHER_ACTION_ID,
    tenant_id: TENANT_A,
    course_id: COURSE_A,
    codigo_accion: `INT-LIVE-${OTHER_ACTION_ID.slice(0, 8)}`,
    training_line: 3,
    environment: "rcetest",
  });
  if (actionIns.error) throw new Error(`seed other action: ${actionIns.error.message}`);

  const enrIns = await svc.from("enrollments").insert({
    id: OTHER_ENROLLMENT_ID,
    tenant_id: TENANT_A,
    action_id: OTHER_ACTION_ID,
    user_id: "aaaaaaaa-0000-4000-8000-000000000004", // tutor@seminarea.test (existe en auth.users)
    run: "8888888-8",
  });
  if (enrIns.error) throw new Error(`seed other enrollment: ${enrIns.error.message}`);
});

afterAll(async () => {
  if (createdSessionIds.length > 0) {
    await svc.from("live_session_attendance").delete().in("session_id", createdSessionIds);
    await svc.from("live_sessions").delete().in("id", createdSessionIds);
  }
  await svc.from("enrollments").delete().eq("id", OTHER_ENROLLMENT_ID);
  await svc.from("actions").delete().eq("id", OTHER_ACTION_ID);
});

async function createAndTrack(raw: Record<string, unknown>): Promise<string> {
  const r = await createLiveSession(adminA, ACTION_A1, raw);
  if (!r.ok) throw new Error(`no se creó la sesión: ${JSON.stringify(r)}`);
  createdSessionIds.push(r.id);
  return r.id;
}

describe("createLiveSession / updateLiveSession / listado", () => {
  it("un student no puede crear (deny-by-default)", async () => {
    const r = await createLiveSession(studentA, ACTION_A1, farFutureRaw());
    expect(r).toEqual({ ok: false, error: "forbidden" });
  });

  it("no se puede crear sobre una acción de OTRO tenant", async () => {
    const r = await createLiveSession(adminB, ACTION_A1, farFutureRaw());
    expect(r).toEqual({ ok: false, error: "not_found" });
  });

  it("rechaza un meetingUrl sin https://", async () => {
    const r = await createLiveSession(adminA, ACTION_A1, farFutureRaw({ meetingUrl: "http://zoom.us/x" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("invalid");
  });

  it("el admin crea una sesión y aparece en el listado de la acción", async () => {
    const raw = farFutureRaw({ title: "Sesión listable" });
    const id = await createAndTrack(raw);
    const sessions = await listSessionsByAction(adminA, ACTION_A1);
    expect(sessions.some((s) => s.id === id && s.title === "Sesión listable")).toBe(true);
  });

  it("el alumno inscrito ve la sesión en listMySessions con su enrollmentId", async () => {
    const id = await createAndTrack(farFutureRaw());
    const mine = await listMySessions(studentA);
    expect(mine.some((s) => s.id === id && s.enrollmentId === ENROLLMENT_STUDENT_A1)).toBe(true);
  });

  it("updateLiveSession edita el título", async () => {
    const id = await createAndTrack(farFutureRaw());
    const r = await updateLiveSession(adminA, id, farFutureRaw({ title: "Título editado" }));
    expect(r.ok).toBe(true);
    const sessions = await listSessionsByAction(adminA, ACTION_A1);
    expect(sessions.find((s) => s.id === id)?.title).toBe("Título editado");
  });
});

describe("markAttendance (staff)", () => {
  it("marca presente a un inscrito de la MISMA acción y aparece en el roster/asistencia", async () => {
    const id = await createAndTrack(farFutureRaw());
    const r = await markAttendance(adminA, id, ENROLLMENT_STUDENT_A1, true, "llegó a tiempo");
    expect(r).toEqual({ ok: true });

    const rows = await attendanceForSession(adminA, id);
    const row = rows?.find((x) => x.enrollmentId === ENROLLMENT_STUDENT_A1);
    expect(row?.present).toBe(true);
    expect(row?.source).toBe("manual");
    expect(row?.note).toBe("llegó a tiempo");
    expect(row?.nombres).toBe("María José");
    expect(row?.apellidos).toBe("Pérez Soto");
  });

  it("rechaza marcar un enrollment de OTRA acción (mismatched_action)", async () => {
    const id = await createAndTrack(farFutureRaw());
    const r = await markAttendance(adminA, id, OTHER_ENROLLMENT_ID, true);
    expect(r).toEqual({ ok: false, error: "mismatched_action" });
  });
});

describe("selfMarkAttendance — ventana exacta + regla manual-gana", () => {
  it("dentro de la ventana (sesión en curso) el alumno se auto-marca", async () => {
    const id = await createAndTrack(inProgressRaw());
    const r = await selfMarkAttendance(studentA, id);
    expect(r).toEqual({ ok: true, kept: "self" });

    const rows = await attendanceForSession(adminA, id);
    const row = rows?.find((x) => x.enrollmentId === ENROLLMENT_STUDENT_A1);
    expect(row?.source).toBe("self");
    expect(row?.present).toBe(true);
  });

  it("fuera de la ventana (sesión que empieza en 1h) rechaza con outside_window", async () => {
    const id = await createAndTrack(farFutureRaw());
    const r = await selfMarkAttendance(studentA, id);
    expect(r).toEqual({ ok: false, error: "outside_window" });
  });

  it("un alumno NO inscrito en la acción de la sesión recibe forbidden", async () => {
    const id = await createAndTrack(inProgressRaw());
    const r = await selfMarkAttendance(notEnrolledA, id);
    expect(r).toEqual({ ok: false, error: "forbidden" });
  });

  it("regla manual-gana: el self-mark NO pisa una marca manual previa", async () => {
    const id = await createAndTrack(inProgressRaw());
    const manual = await markAttendance(adminA, id, ENROLLMENT_STUDENT_A1, false, "el staff dice ausente");
    expect(manual).toEqual({ ok: true });

    const self = await selfMarkAttendance(studentA, id);
    expect(self).toEqual({ ok: true, kept: "manual" });

    const rows = await attendanceForSession(adminA, id);
    const row = rows?.find((x) => x.enrollmentId === ENROLLMENT_STUDENT_A1);
    // La fila NO cambió: sigue "manual" y ausente — el self-mark no la pisó.
    expect(row?.source).toBe("manual");
    expect(row?.present).toBe(false);
    expect(row?.note).toBe("el staff dice ausente");
  });
});

describe("deleteLiveSession — gateado por asistencia", () => {
  it("borra una sesión SIN asistencia registrada", async () => {
    const r0 = await createLiveSession(adminA, ACTION_A1, farFutureRaw());
    if (!r0.ok) throw new Error("no se creó");
    const r = await deleteLiveSession(adminA, r0.id);
    expect(r).toEqual({ ok: true });
    const sessions = await listSessionsByAction(adminA, ACTION_A1);
    expect(sessions.some((s) => s.id === r0.id)).toBe(false);
  });

  it("rechaza borrar una sesión CON asistencia registrada (has_attendance) y no la borra", async () => {
    const id = await createAndTrack(farFutureRaw());
    await markAttendance(adminA, id, ENROLLMENT_STUDENT_A1, true);

    const r = await deleteLiveSession(adminA, id);
    expect(r).toEqual({ ok: false, error: "has_attendance" });

    const sessions = await listSessionsByAction(adminA, ACTION_A1);
    expect(sessions.some((s) => s.id === id)).toBe(true);
  });
});

describe("rosterForSession / exportAttendanceCsv", () => {
  it("el roster incluye inscritos SIN marca (present: null) junto a los marcados", async () => {
    const id = await createAndTrack(farFutureRaw());
    await markAttendance(adminA, id, ENROLLMENT_STUDENT_A1, true);

    const roster = await rosterForSession(adminA, id);
    expect(roster).not.toBeNull();
    const marked = roster?.find((r) => r.enrollmentId === ENROLLMENT_STUDENT_A1);
    const unmarked = roster?.find((r) => r.enrollmentId === ENROLLMENT_RODRIGO_A1);
    expect(marked?.present).toBe(true);
    expect(unmarked?.present).toBeNull();
  });

  it("el CSV exportado trae el disclaimer en la primera línea y el nombre marcado", async () => {
    const id = await createAndTrack(farFutureRaw());
    await markAttendance(adminA, id, ENROLLMENT_STUDENT_A1, true, "ok");

    const exported = await exportAttendanceCsv(adminA, id);
    expect(exported).not.toBeNull();
    const lines = exported!.csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("Asistencia interna — no reemplaza el registro de asistencia SENCE.");
    expect(lines[1]).toBe("NOMBRES;APELLIDOS;PRESENTE;ORIGEN;NOTA;MARCADO");
    expect(lines.some((l) => l.startsWith("María José;Pérez Soto;Sí;Staff;ok;"))).toBe(true);
    expect(exported!.filename).toBe(`asistencia-interna-${id}`);
  });

  it("un student no puede exportar (sin permiso → null)", async () => {
    const id = await createAndTrack(farFutureRaw());
    const exported = await exportAttendanceCsv(studentA, id);
    expect(exported).toBeNull();
  });
});
