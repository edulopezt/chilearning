/**
 * Gate de activación de una acción (task 2.8, HU-3.6). Una acción pasa de
 * borrador a activa solo si tiene fechas; y si es una RE-EJECUCIÓN (se clonó de
 * otra acción), su código debe ser NUEVO — distinto al de origen (no se puede
 * reusar el CodigoCurso de una ejecución previa ante SENCE). Dominio puro.
 */

export type ActivationError = "missing_dates" | "code_unchanged";

export interface ActivationInput {
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly codigoAccion: string;
  /** Código de la acción de origen si es re-ejecución; null si no lo es. */
  readonly originCode: string | null;
}

export function validateActivation(
  input: ActivationInput,
): { ok: true } | { ok: false; error: ActivationError } {
  if (!input.startsOn || !input.endsOn) return { ok: false, error: "missing_dates" };
  if (
    input.originCode !== null &&
    input.codigoAccion.trim() !== "" &&
    input.codigoAccion.trim() === input.originCode.trim()
  ) {
    return { ok: false, error: "code_unchanged" };
  }
  return { ok: true };
}
