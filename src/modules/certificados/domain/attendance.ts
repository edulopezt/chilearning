/**
 * Cálculo puro del % de asistencia para el gate del certificado (task 3.2).
 * Reutiliza la definición del panel de cumplimiento: días con sesión CERRADA
 * sobre los días hábiles del rango. Sin IO.
 */

export interface DayCell {
  readonly status: "cerrada" | "iniciada" | "error" | "none" | "exento";
}

/** % de asistencia (0–100) = días `cerrada` / total de días hábiles. */
export function attendancePctFromCells(cells: readonly DayCell[]): number {
  if (cells.length === 0) return 0;
  const attended = cells.filter((c) => c.status === "cerrada").length;
  return Math.round((attended / cells.length) * 100);
}
