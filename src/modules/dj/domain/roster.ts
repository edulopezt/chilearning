/**
 * Nómina exportable de DJ para la GCA (task 3.3, HU-5.6). Pura.
 */

import type { DjState } from "./state-machine";

export const DJ_STATE_LABEL: Record<DjState, string> = {
  pendiente_emitir: "Pendiente de emitir",
  pendiente_validacion: "Pendiente de validación",
  emitida: "Emitida",
  aprobado_reemision: "Aprobado para re-emisión",
  rechazado_reemision: "Rechazado para re-emisión",
  anulada: "Anulada",
};

export const DJ_ROSTER_HEADERS = [
  "Nombres", "Apellidos", "RUN", "Estado DJ", "Fecha límite liquidación", "Vencida", "Última actualización",
] as const;

export interface DjRosterEntry {
  readonly nombres: string;
  readonly apellidos: string;
  readonly run: string;
  readonly state: DjState;
  readonly settlementDeadline: string | null;
  readonly overdue: boolean;
  readonly updatedAt: string;
}

export function djRosterRow(e: DjRosterEntry): string[] {
  return [
    e.nombres,
    e.apellidos,
    e.run,
    DJ_STATE_LABEL[e.state],
    e.settlementDeadline ?? "",
    e.overdue ? "Sí" : "No",
    e.updatedAt,
  ];
}
