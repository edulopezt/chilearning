import { describe, expect, it } from "vitest";

import {
  buildAttendanceMatrix,
  businessDays,
  EXPORT_HEADERS,
  exportRowValues,
  formatSantiago,
  santiagoDate,
  toCsv,
  topErrors,
  type ExportRow,
} from "./cumplimiento";

describe("businessDays (huecos, D-021: L–V hasta hoy, sin feriados v1)", () => {
  it("excluye fines de semana y capa el rango a hoy", () => {
    // 2026-07-13 es lunes; hoy 2026-07-15 (miércoles) capa antes del término.
    expect(businessDays("2026-07-13", "2026-07-31", "2026-07-15")).toEqual([
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
    ]);
    // Semana completa con fin de semana adentro.
    expect(businessDays("2026-07-10", "2026-07-14", "2026-12-31")).toEqual([
      "2026-07-10", // viernes
      "2026-07-13", // lunes
      "2026-07-14",
    ]);
  });

  it("sin fechas o rango futuro → vacío", () => {
    expect(businessDays(null, "2026-07-31", "2026-07-15")).toEqual([]);
    expect(businessDays("2026-07-13", null, "2026-07-15")).toEqual([]);
    expect(businessDays("2026-08-01", "2026-08-31", "2026-07-15")).toEqual([]);
  });
});

describe("buildAttendanceMatrix", () => {
  const days = ["2026-07-13", "2026-07-14"];
  // 15:00Z = 11:00 Santiago (invierno UTC-4): mismo día local.
  const d13 = Date.parse("2026-07-13T15:00:00Z");
  const d14 = Date.parse("2026-07-14T15:00:00Z");
  const students = [
    { enrollmentId: "e1", nombres: "Ana", apellidos: "Díaz", run: "1-9", exento: false },
    { enrollmentId: "e2", nombres: "Beto", apellidos: "Soto", run: "2-7", exento: true },
  ];

  it("la mejor evidencia del día gana (cerrada > iniciada > error) y los huecos son días sin cierre", () => {
    const rows = buildAttendanceMatrix(days, students, [
      { enrollmentId: "e1", status: "iniciada", openedAtMs: d13, createdAtMs: d13 },
      { enrollmentId: "e1", status: "cerrada", openedAtMs: d13, createdAtMs: d13 },
      { enrollmentId: "e1", status: "error", openedAtMs: null, createdAtMs: d14 },
    ]);
    expect(rows[0]?.cells).toEqual([
      { date: "2026-07-13", status: "cerrada" },
      { date: "2026-07-14", status: "error" },
    ]);
    expect(rows[0]?.gaps).toEqual(["2026-07-14"]);
  });

  it("los exentos no tienen huecos ni celdas de asistencia", () => {
    const rows = buildAttendanceMatrix(days, students, []);
    expect(rows[1]?.cells.every((c) => c.status === "exento")).toBe(true);
    expect(rows[1]?.gaps).toEqual([]);
  });

  it("expiradas y pendientes NO cuentan como evidencia", () => {
    const rows = buildAttendanceMatrix(days, students, [
      { enrollmentId: "e1", status: "expirada", openedAtMs: d13, createdAtMs: d13 },
      { enrollmentId: "e1", status: "iniciada_pendiente", openedAtMs: null, createdAtMs: d13 },
    ]);
    expect(rows[0]?.cells[0]?.status).toBe("none");
  });
});

describe("export — columnas verbatim del plugin + ID SESION SENCE (decisión de Edu)", () => {
  it("los 8 rótulos son EXACTOS (7 del plugin + la columna extra)", () => {
    expect([...EXPORT_HEADERS]).toEqual([
      "CURSO",
      "NOMBRES",
      "APELLIDOS",
      "RUN",
      "CODIGO CURSO",
      "ID SENCE",
      "FECHA/HORA DE ASISTENCIA",
      "ID SESION SENCE",
    ]);
  });

  it("ANTI-INVERSIÓN I-10: 'ID SENCE' lleva el código de la ACCIÓN y 'CODIGO CURSO' el CodSence", () => {
    const row: ExportRow = {
      curso: "Curso X",
      nombres: "Ana",
      apellidos: "Díaz",
      run: "5126663-3",
      codigoCurso: "1237999888", // CodSence del CURSO
      idSence: "RLAB-19-02-08-0071", // código de la ACCIÓN (rótulo histórico)
      fechaHora: "15-07-2026 10:00:00",
      idSesionSence: "998877",
    };
    const values = exportRowValues(row);
    const at = (header: string): string => values[EXPORT_HEADERS.indexOf(header as never)]!;
    expect(at("CODIGO CURSO")).toBe("1237999888");
    expect(at("ID SENCE")).toBe("RLAB-19-02-08-0071");
    expect(at("ID SESION SENCE")).toBe("998877");
  });
});

describe("helpers de fecha (América/Santiago)", () => {
  // 2026-07-15T18:30:45Z = 14:30:45 en Chile (invierno UTC-4).
  const T = Date.parse("2026-07-15T18:30:45Z");
  it("santiagoDate y formatSantiago (d-m-Y H:i:s del plugin)", () => {
    expect(santiagoDate(T)).toBe("2026-07-15");
    expect(formatSantiago(T)).toBe("15-07-2026 14:30:45");
  });
});

describe("topErrors", () => {
  it("cuenta, ordena y trae la glosa oficial; los no catalogados no revientan", () => {
    const top = topErrors([
      { errorCodes: ["207"] },
      { errorCodes: ["207", "204"] },
      { errorCodes: ["999"] },
      { errorCodes: [""] },
    ]);
    expect(top[0]).toMatchObject({ code: "207", count: 2 });
    expect(top[0]?.officialGlosa.length).toBeGreaterThan(0);
    expect(top.find((e) => e.code === "999")?.officialGlosa).toContain("no catalogado");
  });
});

describe("toCsv (Excel es-CL)", () => {
  it("BOM + separador ; + escapado de comillas y saltos", () => {
    const csv = toCsv(["A", "B"], [["hola;chao", 'di "x"']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("A;B");
    expect(csv).toContain('"hola;chao";"di ""x"""');
  });
});
