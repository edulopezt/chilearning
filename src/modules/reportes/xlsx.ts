import "server-only";

import ExcelJS from "exceljs";

/**
 * Wrapper FINO sobre exceljs (ADR-008): solo ESCRITURA de .xlsx, server-only.
 * Se eligió exceljs sobre SheetJS porque el paquete npm de este último quedó
 * congelado en 0.18.5 con CVEs corregidos solo fuera de npm (D-021). Si algún
 * día se reemplaza, este es el único archivo que cambia.
 */
export async function buildXlsx(
  sheetName: string,
  headers: readonly string[],
  rows: readonly string[][],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow([...headers]);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow([...row]);
  // Anchos legibles sin medir texto: título o 14, lo que sea mayor.
  sheet.columns.forEach((col, i) => {
    col.width = Math.max((headers[i] ?? "").length + 2, 14);
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
