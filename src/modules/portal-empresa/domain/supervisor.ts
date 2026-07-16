import { z } from "zod";

/**
 * Dominio puro del Portal Supervisor (task 3.11, HU-12.1/12.2). El fiscalizador es
 * SOLO LECTURA (task 2.5); aquí se modela su LLAVE: vigencia (expiración),
 * revocación y ALCANCE (todo el tenant, o un conjunto de acciones). Sin IO.
 */

export type SupervisorScope = "tenant" | "actions";

export type GrantStatus = "active" | "expired" | "revoked";

export interface GrantTimes {
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}

/** Estado efectivo de un grant en un instante dado (revocado gana a expirado). */
export function grantStatus(g: GrantTimes, nowIso: string): GrantStatus {
  if (g.revokedAt !== null) return "revoked";
  if (g.expiresAt !== null && g.expiresAt <= nowIso) return "expired";
  return "active";
}

export function isGrantActive(g: GrantTimes, nowIso: string): boolean {
  return grantStatus(g, nowIso) === "active";
}

/** Entrada validada para crear/invitar un supervisor con alcance y vigencia. */
export const createGrantSchema = z
  .object({
    email: z.string().trim().email().max(320),
    scope: z.enum(["tenant", "actions"]),
    actionIds: z.array(z.string().uuid()).max(500).optional().default([]),
    // Fecha de expiración (YYYY-MM-DD) o null = sin expiración.
    expiresOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional()
      .default(null),
  })
  .refine((v) => v.scope === "tenant" || v.actionIds.length > 0, {
    message: "El alcance por acciones exige al menos una acción.",
    path: ["actionIds"],
  });

export type CreateGrantInput = z.infer<typeof createGrantSchema>;

/** Deduplica y normaliza los ids de acción del alcance. */
export function normalizeActionIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** Convierte `expiresOn` (fecha) al fin del día en UTC, o null. */
export function expiresOnToTimestamp(expiresOn: string | null): string | null {
  if (!expiresOn) return null;
  return `${expiresOn}T23:59:59.000Z`;
}
