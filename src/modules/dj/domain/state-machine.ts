/**
 * Máquina de estados de la Declaración Jurada (task 3.3, HU-5.6). Pura, estilo
 * `sence/domain/session.ts`. Las transiciones ilegales se rechazan (no cambian el
 * estado). Ventana de liquidación configurable (default 60 días corridos). Sin IO.
 */

export const DJ_STATES = [
  "pendiente_emitir", "pendiente_validacion", "emitida", "aprobado_reemision", "rechazado_reemision", "anulada",
] as const;
export type DjState = (typeof DJ_STATES)[number];

/** Transiciones legales por estado (guía GCA v1.3). `anulada` es terminal. */
export const TRANSITIONS: Record<DjState, readonly DjState[]> = {
  pendiente_emitir: ["pendiente_validacion", "emitida", "anulada"],
  pendiente_validacion: ["emitida", "rechazado_reemision", "anulada"],
  emitida: ["aprobado_reemision", "rechazado_reemision", "anulada"],
  rechazado_reemision: ["pendiente_validacion", "emitida", "anulada"],
  aprobado_reemision: ["emitida", "anulada"],
  anulada: [],
};

export function canTransition(from: DjState, to: DjState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function applyTransition(from: DjState, to: DjState): { changed: boolean; next: DjState } {
  return canTransition(from, to) ? { changed: true, next: to } : { changed: false, next: from };
}

export const DEFAULT_SETTLEMENT_DAYS = 60;

/** Fecha límite de liquidación = término de la acción + N días corridos (YYYY-MM-DD). */
export function settlementDeadline(endsOn: string | null, days = DEFAULT_SETTLEMENT_DAYS): string | null {
  if (!endsOn) return null;
  const d = new Date(`${endsOn}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ¿Vencida? (hoy > fecha límite y aún no terminada). Sin feriados (v1). */
export function isOverdue(deadline: string | null, today: string): boolean {
  return deadline !== null && today > deadline;
}
