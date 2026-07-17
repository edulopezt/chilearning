import { z } from "zod";

/**
 * Feature flags por tenant (task 5.3, HU-1.3) — dominio puro, sin IO.
 *
 * Contrato: una función desactivada DESAPARECE de la UI y sus endpoints
 * responden 403 (`feature_disabled`) — lo hace cumplir `src/lib/feature-flags.ts`.
 * Los flags viven en `tenants.flags` (jsonb). Deny-by-default (P7): SOLO
 * `flags[key] === true` habilita; null, ausente, malformado o un valor que no
 * sea el booleano `true` deniegan.
 */

/** Claves iniciales del Hito 5 (las consumen los PRs 5.1/5.8/5.11). */
export const FEATURE_KEYS = ["scorm", "ai_tutor", "whatsapp"] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** ¿Está habilitada la feature? `flags` llega crudo de la BD (jsonb). */
export function isFeatureEnabled(flags: unknown, key: FeatureKey): boolean {
  if (typeof flags !== "object" || flags === null || Array.isArray(flags)) return false;
  return (flags as Record<string, unknown>)[key] === true;
}

/**
 * Actualización PARCIAL de flags: solo claves conocidas, solo booleanos
 * (un string "true" o una clave desconocida rechazan la entrada completa).
 */
export const flagsUpdateSchema = z.partialRecord(z.enum(FEATURE_KEYS), z.boolean());

export type FlagsUpdate = z.infer<typeof flagsUpdateSchema>;
