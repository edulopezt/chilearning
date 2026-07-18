/**
 * Chequeo PURO de límites de uso del Tutor IA (task 5.8a, HU-11.2). El
 * ESQUEMA de los límites vive en esta migración (`tutor_course_config.daily_message_limit`,
 * `tutor_tenant_budget.monthly_token_budget`); el ENFORCEMENT en runtime (leer
 * los contadores reales, llamar esto, y bloquear el endpoint) llega en la 5.8b.
 * Sin IO: el llamador hace las queries y le pasa los números ya resueltos.
 */

/** Límite diario de mensajes por alumno cuando `tutor_course_config.daily_message_limit`
 *  es `NULL` (task 5.8b, HU-11.2). */
export const DEFAULT_DAILY_MESSAGE_LIMIT = 30;

export interface TutorBudgetInput {
  readonly messagesToday: number;
  readonly dailyLimit: number;
  readonly tenantTokensThisMonth: number;
  readonly monthlyBudget: number;
}

export type TutorBudgetBlockReason = "daily_limit" | "tenant_budget";

export interface TutorBudgetResult {
  readonly allowed: boolean;
  readonly reason: TutorBudgetBlockReason | null;
}

/**
 * Bloquea al LLEGAR al tope (`>=`), no al superarlo: si `dailyLimit` es 5, el
 * 5º mensaje del día ya se cuenta como "ya usado" y el intento de mandar el
 * 6º (`messagesToday === 5`) se bloquea — no se deja pasar un N+1 tras llegar
 * al tope N. Mismo criterio para el presupuesto mensual del tenant.
 *
 * El presupuesto del TENANT se evalúa primero: es el corte de plataforma
 * (si la OTEC se quedó sin presupuesto, es la restricción vinculante sin
 * importar cuánto margen diario le quede a este alumno en particular).
 */
export function checkTutorBudget(input: TutorBudgetInput): TutorBudgetResult {
  if (input.tenantTokensThisMonth >= input.monthlyBudget) {
    return { allowed: false, reason: "tenant_budget" };
  }
  if (input.messagesToday >= input.dailyLimit) {
    return { allowed: false, reason: "daily_limit" };
  }
  return { allowed: true, reason: null };
}
