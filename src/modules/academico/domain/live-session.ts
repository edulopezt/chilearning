/**
 * Dominio puro del sincrónico en vivo (task 5.4, spec §7-R3): valida la
 * programación de una sesión en vivo (enlace EXTERNO a Zoom/Meet/Teams — la
 * videoconferencia propia queda fuera de alcance v1), la ventana de auto-marca
 * de asistencia y el CSV de exportación. Sin IO.
 *
 * ⚠ Esto es asistencia INTERNA, informativa — NO es el registro de asistencia
 * SENCE (RCE/Clave Única), cuya norma para sesiones sincrónicas está pendiente
 * de verificación (spec §7-R3, ver docs/sence/SINCRONICO-PENDIENTE-NORMA.md).
 * Este archivo no importa ni referencia `src/modules/sence/` en ninguna forma.
 */

export const LIVE_SESSION_PROVIDERS = ["zoom", "meet", "teams", "otro"] as const;
export type LiveSessionProvider = (typeof LIVE_SESSION_PROVIDERS)[number];

export interface LiveSessionInput {
  readonly title: string;
  readonly provider: LiveSessionProvider;
  readonly meetingUrl: string;
  readonly startsAtISO: string;
  readonly endsAtISO: string;
  readonly details: string;
}

export type LiveSessionField = "title" | "provider" | "meetingUrl" | "dates" | "details";
export interface LiveSessionFieldError {
  readonly field: LiveSessionField;
  readonly message: string;
}
export type LiveSessionParseResult =
  | { readonly ok: true; readonly value: LiveSessionInput }
  | { readonly ok: false; readonly errors: LiveSessionFieldError[] };

export function parseLiveSessionInput(raw: {
  title?: unknown;
  provider?: unknown;
  meetingUrl?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  details?: unknown;
}): LiveSessionParseResult {
  const errors: LiveSessionFieldError[] = [];

  const title = String(raw.title ?? "").trim();
  if (title.length < 1 || title.length > 200) {
    errors.push({ field: "title", message: "El título debe tener entre 1 y 200 caracteres." });
  }

  const provider = String(raw.provider ?? "") as LiveSessionProvider;
  if (!LIVE_SESSION_PROVIDERS.includes(provider)) {
    errors.push({ field: "provider", message: "Elige una plataforma válida (Zoom, Meet, Teams u otra)." });
  }

  const meetingUrl = String(raw.meetingUrl ?? "").trim();
  if (!meetingUrl.startsWith("https://") || meetingUrl.length > 500) {
    errors.push({ field: "meetingUrl", message: "El enlace debe empezar con https:// (máximo 500 caracteres)." });
  }

  const startsRaw = String(raw.startsAt ?? "").trim();
  const endsRaw = String(raw.endsAt ?? "").trim();
  const startsMs = Date.parse(startsRaw);
  const endsMs = Date.parse(endsRaw);
  if (!startsRaw || Number.isNaN(startsMs)) {
    errors.push({ field: "dates", message: "La fecha y hora de inicio es inválida." });
  }
  if (!endsRaw || Number.isNaN(endsMs)) {
    errors.push({ field: "dates", message: "La fecha y hora de término es inválida." });
  }
  if (!Number.isNaN(startsMs) && !Number.isNaN(endsMs) && endsMs <= startsMs) {
    errors.push({ field: "dates", message: "La fecha y hora de término debe ser posterior al inicio." });
  }

  const details = String(raw.details ?? "").trim();
  if (details.length > 2000) {
    errors.push({ field: "details", message: "Los detalles no pueden superar 2000 caracteres." });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      provider,
      meetingUrl,
      startsAtISO: new Date(startsMs).toISOString(),
      endsAtISO: new Date(endsMs).toISOString(),
      details,
    },
  };
}

/**
 * Ventana de auto-marca de asistencia (decisión de diseño de esta tarea, NO
 * norma SENCE): desde 15 minutos antes del inicio hasta el fin de la sesión.
 * Constante nombrada — nunca usar el número mágico 900000 en el código.
 */
export const SELF_MARK_WINDOW_MS = 15 * 60_000;

/** ¿Puede el alumno auto-marcar su asistencia en `nowMs`? Ventana [starts - 15min, ends]. */
export function canSelfMark(startsAtMs: number, endsAtMs: number, nowMs: number): boolean {
  return nowMs >= startsAtMs - SELF_MARK_WINDOW_MS && nowMs <= endsAtMs;
}

// ---------- Export CSV de asistencia interna ----------

/**
 * Disclaimer OBLIGATORIO en la primera línea del export (y visible en la UI):
 * esta asistencia es interna/informativa, no el registro SENCE.
 */
export const ATTENDANCE_DISCLAIMER =
  "Asistencia interna — no reemplaza el registro de asistencia SENCE.";

export const ATTENDANCE_CSV_HEADERS = [
  "NOMBRES",
  "APELLIDOS",
  "PRESENTE",
  "ORIGEN",
  "NOTA",
  "MARCADO",
] as const;

export interface AttendanceCsvRow {
  readonly nombres: string;
  readonly apellidos: string;
  readonly present: boolean;
  readonly source: "self" | "manual";
  readonly note: string;
  /** Ya formateada por el llamador (dd-mm-aaaa HH:mm, hora de Santiago). */
  readonly markedAt: string;
}

/**
 * Escape anti-inyección de fórmulas (CWE-1236) idéntico al de
 * `src/modules/reportes/domain/cumplimiento.ts::toCsv` — SE REPLICA a
 * propósito y NO SE IMPORTA de ahí: ese archivo importa
 * `@/modules/sence/errors` (glosas oficiales SENCE), y esta tarea tiene
 * PROHIBIDO ABSOLUTO tocar/importar `src/modules/sence/` en cualquier forma,
 * ni siquiera transitivamente vía un import compartido.
 */
function escapeCsvValue(value: string): string {
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV con BOM UTF-8, separador `;` y el disclaimer como PRIMERA línea. */
export function attendanceCsv(rows: readonly AttendanceCsvRow[]): string {
  const dataLines = rows.map((r) =>
    [
      r.nombres,
      r.apellidos,
      r.present ? "Sí" : "No",
      r.source === "self" ? "Alumno" : "Staff",
      r.note,
      r.markedAt,
    ]
      .map(escapeCsvValue)
      .join(";"),
  );
  const lines = [ATTENDANCE_DISCLAIMER, ATTENDANCE_CSV_HEADERS.join(";"), ...dataLines];
  return `﻿${lines.join("\r\n")}\r\n`;
}

const SANTIAGO_TZ = "America/Santiago";

/**
 * dd-mm-aaaa HH:mm en América/Santiago, para la columna MARCADO del export.
 * Duplica A PROPÓSITO el formateador equivalente de
 * `reportes/domain/cumplimiento.ts::formatSantiago`: ese módulo importa
 * `@/modules/sence/errors` y este dominio tiene prohibido tocar/importar
 * `src/modules/sence/` en cualquier forma, ni siquiera transitivamente.
 */
export function formatMarkedAt(epochMs: number): string {
  const parts = new Intl.DateTimeFormat("es-CL", {
    timeZone: SANTIAGO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(epochMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  // Intl con h23 puede emitir "24" a medianoche según el runtime: se normaliza
  // (mismo cuidado que el formateador que se replica).
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("day")}-${get("month")}-${get("year")} ${hour}:${get("minute")}`;
}
