import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Frontera de automatización n8n (task 3.9, HU-5.9). PURO, importable por el
 * worker (sin `@/`, sin `server-only`). Garantía RNF-10 por construcción: a n8n
 * SOLO van seudónimos HMAC y agregados — nunca RUN, nombre ni correo. El correo
 * con destinatario real lo manda el worker por `EmailSender`.
 */

export const AUTOMATION_KINDS = ["no_attendance", "inactive", "coordinator_report"] as const;
export type AutomationKind = (typeof AUTOMATION_KINDS)[number];

/** Seudónimo determinista y NO reversible de un id (HMAC-SHA256 con el secreto del
 *  tenant). n8n correlaciona sin ver el id real. */
export function pseudonymize(secret: string, ...parts: string[]): string {
  return createHmac("sha256", secret).update(parts.join("|")).digest("hex").slice(0, 32);
}

/** Firma HMAC del cuerpo del webhook (hex). n8n valida el origen. */
export function signWebhook(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** Verificación en tiempo constante (anti-timing). */
export function verifyWebhook(secret: string, body: string, signature: string): boolean {
  const expected = Buffer.from(signWebhook(secret, body), "utf8");
  const got = Buffer.from(signature, "utf8");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Evento que se envía a n8n: agregado + seudónimos. SIN PII (por construcción). */
export interface N8nReminderEvent {
  readonly type: "reminder";
  readonly kind: AutomationKind;
  readonly tenant: string; // seudónimo
  readonly action: string; // seudónimo
  readonly recipients: readonly string[]; // seudónimos
  readonly count: number;
  readonly at: string;
}

/**
 * Construye el evento n8n a partir de ids REALES pero emitiendo SOLO seudónimos.
 * Nunca recibe ni emite RUN/nombre/correo: la firma no lo permite.
 */
export function buildN8nEvent(
  secret: string,
  input: { kind: AutomationKind; tenantId: string; actionId: string; recipientUserIds: readonly string[]; at: string },
): N8nReminderEvent {
  return {
    type: "reminder",
    kind: input.kind,
    tenant: pseudonymize(secret, input.tenantId),
    action: pseudonymize(secret, input.tenantId, input.actionId),
    recipients: input.recipientUserIds.map((u) => pseudonymize(secret, input.tenantId, u)),
    count: input.recipientUserIds.length,
    at: input.at,
  };
}
