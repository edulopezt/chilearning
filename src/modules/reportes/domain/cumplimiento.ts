import { getSenceErrorEntry } from "@/modules/sence/errors";

/**
 * Task 2.4 (HU-5.5) — dominio puro del panel de cumplimiento SENCE:
 * matriz alumno×día, huecos, errores frecuentes y el EXPORT con las columnas
 * VERBATIM del plugin Moodle original (`block_sence/sence_src/sence_report.php`).
 *
 * ⚠ Quirk I-10 heredado del plugin (decisión de Edu 2026-07-15): los rótulos
 * históricos van "cruzados" — la columna "CODIGO CURSO" trae el código SENCE
 * del curso (CodSence) y la columna "ID SENCE" trae el código de la ACCIÓN
 * (CodigoCurso), NO el IdSesionSence. Se preservan tal cual por compatibilidad
 * de fiscalización y se AGREGA la columna "ID SESION SENCE" con el id real.
 *
 * "Huecos" (definición operativa, D-021): días hábiles L–V dentro de
 * [starts_on, min(ends_on, hoy)] sin ninguna sesión CERRADA del alumno.
 * Sin feriados chilenos en v1 (follow-up anotado). Los exentos no tienen
 * huecos (no registran SENCE, I-14).
 */

/** Rótulos EXACTOS del plugin + la columna extra decidida por Edu. */
export const EXPORT_HEADERS = [
  "CURSO",
  "NOMBRES",
  "APELLIDOS",
  "RUN",
  "CODIGO CURSO",
  "ID SENCE",
  "FECHA/HORA DE ASISTENCIA",
  "ID SESION SENCE",
] as const;

export interface ExportRow {
  readonly curso: string;
  readonly nombres: string;
  readonly apellidos: string;
  readonly run: string;
  /** CodSence del curso (vacío en línea 1) — rótulo "CODIGO CURSO". */
  readonly codigoCurso: string;
  /** Código de la ACCIÓN — rótulo histórico "ID SENCE" (I-10). */
  readonly idSence: string;
  /** `opened_at` en dd-mm-aaaa HH:mm:ss América/Santiago. */
  readonly fechaHora: string;
  /** IdSesionSence real (columna extra). */
  readonly idSesionSence: string;
}

export function exportRowValues(row: ExportRow): string[] {
  return [
    row.curso,
    row.nombres,
    row.apellidos,
    row.run,
    row.codigoCurso,
    row.idSence,
    row.fechaHora,
    row.idSesionSence,
  ];
}

export type DayCellStatus = "cerrada" | "iniciada" | "error" | "none" | "exento";

export interface MatrixStudent {
  readonly enrollmentId: string;
  readonly nombres: string;
  readonly apellidos: string;
  readonly run: string;
  readonly exento: boolean;
}

export interface MatrixSession {
  readonly enrollmentId: string;
  readonly status: string;
  /** epoch ms del inicio confirmado (null si nunca abrió). */
  readonly openedAtMs: number | null;
  /** epoch ms de creación (respaldo de atribución para sesiones en error). */
  readonly createdAtMs: number;
}

export interface StudentDayRow {
  readonly enrollmentId: string;
  readonly nombres: string;
  readonly apellidos: string;
  readonly run: string;
  readonly exento: boolean;
  readonly cells: readonly { date: string; status: DayCellStatus }[];
  /** Días hábiles del rango sin sesión cerrada (vacío para exentos). */
  readonly gaps: readonly string[];
}

export interface FrequentError {
  readonly code: string;
  readonly count: number;
  /** Glosa oficial del manual (panel de staff; jamás al alumno, I-9). */
  readonly officialGlosa: string;
  readonly severity: string;
}

const TZ = "America/Santiago";

/** Fecha local Santiago YYYY-MM-DD de un epoch ms. */
export function santiagoDate(epochMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochMs));
}

/** dd-mm-aaaa HH:mm:ss en América/Santiago (formato del plugin, d-m-Y H:i:s). */
export function formatSantiago(epochMs: number): string {
  const parts = new Intl.DateTimeFormat("es-CL", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(epochMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  // Intl con h23 puede emitir "24" a medianoche según el runtime: se normaliza.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("day")}-${get("month")}-${get("year")} ${hour}:${get("minute")}:${get("second")}`;
}

/**
 * Días hábiles L–V (YYYY-MM-DD, hora de Santiago) en [startsOn, min(endsOn, hoy)].
 * Sin fechas → lista vacía (el panel avisa "define fechas para calcular huecos").
 */
export function businessDays(
  startsOn: string | null,
  endsOn: string | null,
  todayIsoDate: string,
): string[] {
  if (!startsOn || !endsOn) return [];
  const end = endsOn < todayIsoDate ? endsOn : todayIsoDate;
  if (startsOn > end) return [];

  const days: string[] = [];
  // Mediodía UTC evita saltos de día por huso al iterar fechas puras.
  const cursor = new Date(`${startsOn}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor.getTime() <= last.getTime()) {
    const dow = cursor.getUTCDay();
    if (dow >= 1 && dow <= 5) {
      days.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

const CELL_RANK: Record<DayCellStatus, number> = {
  none: 0,
  error: 1,
  iniciada: 2,
  cerrada: 3,
  exento: 4, // no compite: se asigna directo
};

/** Matriz alumno×día: la mejor evidencia del día por alumno; huecos por fila. */
export function buildAttendanceMatrix(
  days: readonly string[],
  students: readonly MatrixStudent[],
  sessions: readonly MatrixSession[],
): StudentDayRow[] {
  // (enrollment, día local) → mejor estado observado ese día.
  const best = new Map<string, DayCellStatus>();
  for (const s of sessions) {
    const status: DayCellStatus =
      s.status === "cerrada" || s.status === "iniciada" || s.status === "error"
        ? (s.status as DayCellStatus)
        : "none";
    if (status === "none") continue; // pendientes/expiradas no son evidencia de asistencia
    const day = santiagoDate(s.openedAtMs ?? s.createdAtMs);
    const key = `${s.enrollmentId}|${day}`;
    const prev = best.get(key) ?? "none";
    if (CELL_RANK[status] > CELL_RANK[prev]) best.set(key, status);
  }

  return students.map((student) => {
    if (student.exento) {
      return {
        ...student,
        cells: days.map((date) => ({ date, status: "exento" as const })),
        gaps: [],
      };
    }
    const cells = days.map((date) => ({
      date,
      status: best.get(`${student.enrollmentId}|${date}`) ?? ("none" as const),
    }));
    const gaps = cells.filter((c) => c.status !== "cerrada").map((c) => c.date);
    return { ...student, cells, gaps };
  });
}

/** Top-N de códigos de error con su glosa oficial (panel staff, I-9 intacto). */
export function topErrors(
  events: readonly { errorCodes: readonly string[] }[],
  limit = 5,
): FrequentError[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    for (const code of e.errorCodes) {
      const key = code.trim();
      if (key === "") continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([code, count]) => {
      const numeric = Number(code);
      const entry = Number.isInteger(numeric) ? getSenceErrorEntry(numeric) : undefined;
      return {
        code,
        count,
        officialGlosa: entry?.officialGlosa ?? "Código no catalogado en el manual vigente",
        severity: entry?.severity ?? "unknown",
      };
    });
}

/** CSV con BOM UTF-8 y separador `;` (Excel es-CL abre coma como una columna). */
export function toCsv(headers: readonly string[], rows: readonly string[][]): string {
  const escape = (value: string): string =>
    /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const lines = [headers.map(escape).join(";"), ...rows.map((r) => r.map(escape).join(";"))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
