import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { EXPORT_HEADERS } from "./domain/cumplimiento";
import { buildXlsx } from "./xlsx";

describe("buildXlsx (ADR-008 — exceljs solo-escritura)", () => {
  it("produce un .xlsx legible con los encabezados verbatim y las filas", async () => {
    const buffer = await buildXlsx("Asistencia SENCE", EXPORT_HEADERS, [
      ["Curso X", "Ana", "Díaz", "5126663-3", "1237999888", "ACC-1", "15-07-2026 10:00:00", "998877"],
    ]);
    expect(buffer.length).toBeGreaterThan(0);

    // Relee el buffer con exceljs: el archivo debe ser un XLSX válido.
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Asistencia SENCE");
    expect(sheet).toBeDefined();
    const headerRow = sheet!.getRow(1).values as (string | undefined)[];
    // exceljs indexa desde 1: values[0] es undefined.
    expect(headerRow.slice(1)).toEqual([...EXPORT_HEADERS]);
    const dataRow = sheet!.getRow(2).values as (string | undefined)[];
    expect(dataRow[1]).toBe("Curso X");
    expect(dataRow[6]).toBe("ACC-1"); // "ID SENCE" = código de la ACCIÓN (I-10)
    expect(dataRow[8]).toBe("998877"); // columna extra ID SESION SENCE
  });
});
