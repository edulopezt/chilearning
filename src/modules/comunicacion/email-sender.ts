/**
 * Envío real de correos transaccionales (Hito 2 — decisión de Edu 2026-07-15:
 * proveedor Resend). Complementa las plantillas puras de `domain/email-templates`.
 *
 * Diseño:
 *  - `EmailSender` es la interfaz que consumen los servicios (inyectable: los
 *    tests usan un fake; jamás se llama la API real en CI).
 *  - Implementación Resend por **fetch a la REST API** (sin SDK: una dependencia
 *    menos en la cadena de suministro; el endpoint es un POST simple).
 *  - Sin `RESEND_API_KEY`, `emailSenderFromEnv` degrada a un sender no-op que
 *    loguea y reporta `not_configured`: ningún flujo se bloquea por falta de
 *    proveedor (el gate de "envío real verificado" es de staging, no del código).
 *
 * Reglas: jamás loguear la dirección completa del destinatario (minimización,
 * Ley 21.719) — usar `maskEmail`. El contenido ya viene escapado por las
 * plantillas.
 *
 * ⚠ Sin `import "server-only"`: también lo consume el proceso worker (alertas
 * al operador), que corre fuera de React Server Components. No toca secretos
 * más allá de la API key que recibe por config.
 */

export interface OutgoingEmail {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text?: string;
}

export type SendResult =
  | { readonly ok: true; readonly id: string | null }
  | { readonly ok: false; readonly error: string };

export interface EmailSender {
  readonly configured: boolean;
  send(email: OutgoingEmail): Promise<SendResult>;
}

export interface ResendConfig {
  readonly apiKey: string;
  /** Remitente verificado en Resend, ej. `Chilearning <no-responder@chilearning.cl>`. */
  readonly from: string;
  readonly fetchImpl?: typeof fetch;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Enmascara un correo para logs: `juan.perez@otec.cl` → `j***@otec.cl`. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** Construye el request a Resend (puro, unit-testeable). */
export function buildResendRequest(
  email: OutgoingEmail,
  cfg: Pick<ResendConfig, "apiKey" | "from">,
): { url: string; init: RequestInit } {
  return {
    url: RESEND_ENDPOINT,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        ...(email.text ? { text: email.text } : {}),
      }),
    },
  };
}

/** Sender real contra la API de Resend. Nunca lanza: reporta `ok:false`. */
export function resendEmailSender(cfg: ResendConfig): EmailSender {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  return {
    configured: true,
    async send(email: OutgoingEmail): Promise<SendResult> {
      const { url, init } = buildResendRequest(email, cfg);
      try {
        const res = await fetchImpl(url, init);
        if (!res.ok) {
          // El cuerpo de error de Resend puede traer detalles útiles, pero no
          // se reenvía entero a los logs del llamador: status basta para operar.
          console.error("[email] Resend respondió error", {
            status: res.status,
            to: maskEmail(email.to),
          });
          return { ok: false, error: `resend_http_${res.status}` };
        }
        const body = (await res.json().catch(() => null)) as { id?: string } | null;
        return { ok: true, id: body?.id ?? null };
      } catch (err) {
        console.error("[email] fallo de red enviando correo", {
          to: maskEmail(email.to),
          message: (err as Error).message,
        });
        return { ok: false, error: "network_error" };
      }
    },
  };
}

/** Sender no-op para entornos sin proveedor: loguea y reporta not_configured. */
export function noopEmailSender(): EmailSender {
  return {
    configured: false,
    async send(email: OutgoingEmail): Promise<SendResult> {
      console.warn("[email] RESEND_API_KEY no configurada; correo NO enviado", {
        to: maskEmail(email.to),
        subject: email.subject,
      });
      return { ok: false, error: "not_configured" };
    },
  };
}

export const DEFAULT_MAIL_FROM = "Chilearning <no-responder@chilearning.cl>";

/** Sender según el entorno: Resend si hay key; si no, no-op (degrada elegante). */
export function emailSenderFromEnv(env: Record<string, string | undefined>): EmailSender {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return noopEmailSender();
  return resendEmailSender({ apiKey, from: env.MAIL_FROM?.trim() || DEFAULT_MAIL_FROM });
}
