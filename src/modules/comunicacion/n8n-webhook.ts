import { signWebhook, type N8nReminderEvent } from "./domain/automation";

/**
 * Emisor de eventos a n8n (task 3.9). Worker-safe (sin `@/`, sin `server-only`).
 * Degrada a NO-OP sin `N8N_WEBHOOK_URL`/`N8N_WEBHOOK_SECRET`: el turno nocturno y
 * los tests corren en verde sin infra n8n. Firma HMAC en cada envío. Nunca lanza.
 * El payload ya viene SIN PII por construcción (buildN8nEvent) — RNF-10.
 */

export interface N8nEmitter {
  readonly configured: boolean;
  emit(event: N8nReminderEvent): Promise<{ ok: boolean }>;
}

export function noopN8nEmitter(): N8nEmitter {
  return { configured: false, async emit() { return { ok: false }; } };
}

export function n8nEmitter(cfg: { url: string; secret: string; fetchImpl?: typeof fetch }): N8nEmitter {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  return {
    configured: true,
    async emit(event: N8nReminderEvent): Promise<{ ok: boolean }> {
      const body = JSON.stringify(event);
      try {
        const res = await fetchImpl(cfg.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Chilearning-Signature": signWebhook(cfg.secret, body) },
          body,
        });
        return { ok: res.ok };
      } catch {
        return { ok: false };
      }
    },
  };
}

export function n8nEmitterFromEnv(env: Record<string, string | undefined>, fetchImpl?: typeof fetch): N8nEmitter {
  const url = env.N8N_WEBHOOK_URL?.trim();
  const secret = env.N8N_WEBHOOK_SECRET?.trim();
  if (!url || !secret) return noopN8nEmitter();
  return n8nEmitter({ url, secret, fetchImpl });
}
