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

const LIVE_SESSION_TZ = "America/Santiago";
/** `startsAt`/`endsAt` CON offset explícito (Z o ±HH:MM) — no ambiguo. */
const HAS_OFFSET_RE = /(?:Z|[+-]\d{2}:?\d{2})$/;
/** `startsAt`/`endsAt` SIN offset — el formato exacto que envía `<input type="datetime-local">`. */
const NAIVE_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Convierte una hora de reloj (año/mes/día/hora/min/seg) en LA ZONA `timeZone`
 * a epoch ms UTC, sin asumir un offset fijo (Chile ha cambiado sus reglas de
 * horario de verano/invierno más de una vez). Técnica: se toma el primer
 * intento como si fuera UTC, se formatea ESE instante en la zona destino y se
 * corrige por la diferencia — igual que hacen las librerías de zonas horarias,
 * sin depender de ninguna.
 */
function zonedWallClockToEpochMs(y: number, month: number, d: number, h: number, min: number, s: number, timeZone: string): number {
  const guessMs = Date.UTC(y, month - 1, d, h, min, s);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(guessMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const hour = get("hour") % 24; // Intl con h23 puede emitir "24" a medianoche.
  const zonedAsUtcMs = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return guessMs - (zonedAsUtcMs - guessMs);
}

/**
 * Parsea `startsAt`/`endsAt`: si trae offset explícito, `Date.parse` normal
 * (sin ambigüedad). Si NO trae offset (el caso real de `datetime-local`, que
 * NUNCA incluye zona), se interpreta como hora de reloj de Chile — NO como
 * hora local del proceso que ejecuta este código (el contenedor corre en UTC
 * por defecto, lo que desfasaría la sesión 3-4 horas respecto de lo que el
 * staff chileno tecleó).
 */
function parseSessionDateTime(raw: string): number {
  if (HAS_OFFSET_RE.test(raw)) return Date.parse(raw);
  const m = NAIVE_DATETIME_RE.exec(raw);
  if (!m) return Date.parse(raw);
  const [, y, month, d, h, min, s] = m;
  return zonedWallClockToEpochMs(Number(y), Number(month), Number(d), Number(h), Number(min), s ? Number(s) : 0, LIVE_SESSION_TZ);
}

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
  const startsMs = startsRaw ? parseSessionDateTime(startsRaw) : NaN;
  const endsMs = endsRaw ? parseSessionDateTime(endsRaw) : NaN;
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

/**
 * dd-mm-aaaa HH:mm en América/Santiago, para la columna MARCADO del export.
 * Duplica A PROPÓSITO el formateador equivalente de
 * `reportes/domain/cumplimiento.ts::formatSantiago`: ese módulo importa
 * `@/modules/sence/errors` y este dominio tiene prohibido tocar/importar
 * `src/modules/sence/` en cualquier forma, ni siquiera transitivamente.
 */
export function formatMarkedAt(epochMs: number): string {
  const parts = new Intl.DateTimeFormat("es-CL", {
    timeZone: LIVE_SESSION_TZ,
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
