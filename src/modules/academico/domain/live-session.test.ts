import { describe, expect, it } from "vitest";

import {
  ATTENDANCE_CSV_HEADERS,
  ATTENDANCE_DISCLAIMER,
  SELF_MARK_WINDOW_MS,
  attendanceCsv,
  canSelfMark,
  formatMarkedAt,
  parseLiveSessionInput,
} from "@/modules/academico/domain/live-session";

const validRaw = {
  title: "Clase en vivo: cierre de módulo",
  provider: "zoom",
  meetingUrl: "https://zoom.us/j/123456789",
  startsAt: "2026-08-01T15:00:00.000Z",
  endsAt: "2026-08-01T16:00:00.000Z",
  details: "Trae tus dudas del módulo 3.",
};

describe("parseLiveSessionInput", () => {
  it("acepta una entrada válida", () => {
    const r = parseLiveSessionInput(validRaw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe(validRaw.title);
    expect(r.value.provider).toBe("zoom");
    expect(r.value.meetingUrl).toBe(validRaw.meetingUrl);
    expect(r.value.startsAtISO).toBe("2026-08-01T15:00:00.000Z");
    expect(r.value.endsAtISO).toBe("2026-08-01T16:00:00.000Z");
  });

  it("rechaza título vacío", () => {
    const r = parseLiveSessionInput({ ...validRaw, title: "  " });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.field === "title")).toBe(true);
  });

  it("rechaza título de más de 200 caracteres", () => {
    const r = parseLiveSessionInput({ ...validRaw, title: "x".repeat(201) });
    expect(r.ok).toBe(false);
  });

  it("rechaza un provider fuera del enum cerrado", () => {
    const r = parseLiveSessionInput({ ...validRaw, provider: "webex" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.field === "provider")).toBe(true);
  });

  it("acepta 'otro' como provider", () => {
    const r = parseLiveSessionInput({ ...validRaw, provider: "otro" });
    expect(r.ok).toBe(true);
  });

  it("rechaza un meetingUrl que no empieza con https://", () => {
    const r = parseLiveSessionInput({ ...validRaw, meetingUrl: "http://zoom.us/j/123" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.field === "meetingUrl")).toBe(true);
  });

  it("rechaza un meetingUrl de más de 500 caracteres", () => {
    const r = parseLiveSessionInput({ ...validRaw, meetingUrl: `https://zoom.us/${"a".repeat(500)}` });
    expect(r.ok).toBe(false);
  });

  it("rechaza fechas inválidas", () => {
    const r = parseLiveSessionInput({ ...validRaw, startsAt: "no-es-fecha" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.field === "dates")).toBe(true);
  });

  it("rechaza endsAt <= startsAt", () => {
    const r = parseLiveSessionInput({ ...validRaw, endsAt: validRaw.startsAt });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.field === "dates")).toBe(true);
  });

  it("rechaza detalles de más de 2000 caracteres", () => {
    const r = parseLiveSessionInput({ ...validRaw, details: "x".repeat(2001) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.field === "details")).toBe(true);
  });

  it("details vacío es válido (default '')", () => {
    const r = parseLiveSessionInput({ ...validRaw, details: undefined });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.details).toBe("");
  });
});

describe("canSelfMark — ventana [starts - 15min, ends] (bordes exactos)", () => {
  const starts = 1_000_000_000;
  const ends = 1_000_003_600_000; // +1h
  const window = SELF_MARK_WINDOW_MS;

  it("SELF_MARK_WINDOW_MS es 15 minutos exactos", () => {
    expect(window).toBe(15 * 60 * 1000);
  });

  it("justo 1ms ANTES del borde inferior: false", () => {
    expect(canSelfMark(starts, ends, starts - window - 1)).toBe(false);
  });

  it("EXACTO en el borde inferior (starts - 15min): true", () => {
    expect(canSelfMark(starts, ends, starts - window)).toBe(true);
  });

  it("EXACTO en el fin de la sesión: true", () => {
    expect(canSelfMark(starts, ends, ends)).toBe(true);
  });

  it("justo 1ms DESPUÉS del fin: false", () => {
    expect(canSelfMark(starts, ends, ends + 1)).toBe(false);
  });

  it("a mitad de la sesión: true", () => {
    expect(canSelfMark(starts, ends, starts + 100)).toBe(true);
  });
});

describe("attendanceCsv", () => {
  it("la primera línea es el disclaimer, la segunda las cabeceras", () => {
    const csv = attendanceCsv([]);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe(ATTENDANCE_DISCLAIMER);
    expect(lines[1]).toBe(ATTENDANCE_CSV_HEADERS.join(";"));
  });

  it("incluye el BOM UTF-8 al inicio", () => {
    const csv = attendanceCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("serializa filas con Sí/No y Alumno/Staff", () => {
    const csv = attendanceCsv([
      { nombres: "María José", apellidos: "Pérez Soto", present: true, source: "self", note: "", markedAt: "01-08-2026 15:05:00" },
      { nombres: "Rodrigo", apellidos: "Fuentes", present: false, source: "manual", note: "avisó atraso", markedAt: "01-08-2026 15:10:00" },
    ]);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[2]).toBe("María José;Pérez Soto;Sí;Alumno;;01-08-2026 15:05:00");
    expect(lines[3]).toBe("Rodrigo;Fuentes;No;Staff;avisó atraso;01-08-2026 15:10:00");
  });

  it("neutraliza inyección de fórmulas en nombres/notas (CWE-1236)", () => {
    const csv = attendanceCsv([
      { nombres: "=cmd|'/c calc'!A1", apellidos: "x", present: true, source: "manual", note: "@evil", markedAt: "01-08-2026 15:00:00" },
    ]);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[2]).toContain("'=cmd");
    expect(lines[2]).toContain("'@evil");
  });
});

describe("formatMarkedAt", () => {
  it("formatea dd-mm-aaaa HH:mm en hora de Santiago", () => {
    // 2026-08-01T15:05:00Z = 2026-08-01 11:05 en Santiago (agosto = invierno, UTC-4).
    expect(formatMarkedAt(Date.parse("2026-08-01T15:05:00.000Z"))).toBe("01-08-2026 11:05");
  });
});
