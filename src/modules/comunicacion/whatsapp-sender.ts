/**
 * Envío real de plantillas WhatsApp (task 5.11, HU-5.9) vía Meta Cloud API.
 * Espejo exacto de `email-sender.ts` (mismo contrato, mismo estilo de
 * degradación) — léelo primero si algo aquí no se entiende.
 *
 * Diseño:
 *  - `WhatsAppSender` es la interfaz que consume `reminders.ts` (inyectable:
 *    los tests usan un fake; jamás se llama la API real en CI).
 *  - Implementación Meta por **fetch a la Graph API** (sin SDK: una
 *    dependencia menos en la cadena de suministro).
 *  - Sin `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_ACCESS_TOKEN`,
 *    `whatsappSenderFromEnv` degrada a un sender no-op que loguea y reporta
 *    `not_configured`: ningún flujo se bloquea por falta de credenciales (el
 *    canal completo depende de un trámite externo con Meta, ver
 *    `docs/whatsapp/META-BUSINESS-VERIFICATION.md` y `docs/whatsapp/ACTIVATION.md`).
 *
 * Decisión D-049 (extiende a Meta el mismo principio que D-042 sentó para el
 * correo): el envío es DIRECTO desde el worker a Meta — n8n JAMÁS ve un
 * número de teléfono (la lógica crítica con PII vive en código testeable,
 * n8n solo recibe eventos agregados/seudonimizados para automatización
 * periférica). `docs/whatsapp/META-BUSINESS-VERIFICATION.md` decía
 * "orquestado en n8n" — quedó obsoleto, corregido en ese doc.
 *
 * Reglas: jamás loguear el número completo (minimización, Ley 21.719) — usar
 * `maskPhone`. El texto de la plantilla YA fue aprobado por Meta; aquí solo
 * viajan los parámetros (`whatsapp-templates.ts` arma el array ordenado).
 *
 * ⚠ Sin `import "server-only"`: lo consume el proceso worker (`reminders.ts`
 * corre ahí), que está fuera de React Server Components.
 */

export interface OutgoingWhatsApp {
  /** Destinatario en formato E.164, ej. `"+56912345678"`. */
  readonly to: string;
  /** Nombre EXACTO de la plantilla aprobada por Meta (ver `domain/whatsapp-templates.ts`). */
  readonly templateName: string;
  /** Código de idioma de la plantilla aprobada, ej. `"es"`. */
  readonly languageCode: string;
  /** Parámetros posicionales `{{1}}, {{2}}, ...` ya armados por el dominio. */
  readonly bodyParams: readonly string[];
}

export type WhatsAppSendResult =
  | { readonly ok: true; readonly id: string | null }
  | { readonly ok: false; readonly error: string };

export interface WhatsAppSender {
  readonly configured: boolean;
  send(msg: OutgoingWhatsApp): Promise<WhatsAppSendResult>;
}

export interface MetaWhatsAppConfig {
  readonly phoneNumberId: string;
  readonly accessToken: string;
  readonly fetchImpl?: typeof fetch;
}

/** Versión de la Graph API de Meta — actualizar aquí si Meta la deprecia. */
const META_GRAPH_API_VERSION = "v21.0";

/** Enmascara un teléfono para logs: conserva un prefijo y un sufijo cortos,
 *  oculta el resto. Nunca revela el número completo. */
export function maskPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.length <= 7) return "***";
  const head = trimmed.slice(0, 3);
  const tail = trimmed.slice(-3);
  return `${head}***${tail}`;
}

/** Construye el request a la Graph API de Meta (puro, unit-testeable). */
export function buildWhatsAppRequest(
  msg: OutgoingWhatsApp,
  cfg: Pick<MetaWhatsAppConfig, "phoneNumberId" | "accessToken">,
): { url: string; init: RequestInit } {
  return {
    url: `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${cfg.phoneNumberId}/messages`,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: msg.to,
        type: "template",
        template: {
          name: msg.templateName,
          language: { code: msg.languageCode },
          components: [
            {
              type: "body",
              parameters: msg.bodyParams.map((text) => ({ type: "text", text })),
            },
          ],
        },
      }),
    },
  };
}

/** Sender real contra la Cloud API de Meta. Nunca lanza: reporta `ok:false`. */
export function metaWhatsAppSender(cfg: MetaWhatsAppConfig): WhatsAppSender {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  return {
    configured: true,
    async send(msg: OutgoingWhatsApp): Promise<WhatsAppSendResult> {
      const { url, init } = buildWhatsAppRequest(msg, cfg);
      try {
        const res = await fetchImpl(url, init);
        if (!res.ok) {
          // El cuerpo de error de Meta puede traer detalle útil, pero no se
          // reenvía entero a los logs del llamador: status basta para operar.
          console.error("[whatsapp] Meta respondió error", {
            status: res.status,
            to: maskPhone(msg.to),
          });
          return { ok: false, error: `meta_http_${res.status}` };
        }
        const body = (await res.json().catch(() => null)) as { messages?: { id?: string }[] } | null;
        return { ok: true, id: body?.messages?.[0]?.id ?? null };
      } catch (err) {
        console.error("[whatsapp] fallo de red enviando mensaje", {
          to: maskPhone(msg.to),
          message: (err as Error).message,
        });
        return { ok: false, error: "network_error" };
      }
    },
  };
}

/** Sender no-op para entornos sin credenciales: loguea y reporta not_configured. */
export function noopWhatsAppSender(): WhatsAppSender {
  return {
    configured: false,
    async send(msg: OutgoingWhatsApp): Promise<WhatsAppSendResult> {
      console.warn("[whatsapp] credenciales de Meta no configuradas; mensaje NO enviado", {
        to: maskPhone(msg.to),
        template: msg.templateName,
      });
      return { ok: false, error: "not_configured" };
    },
  };
}

/** Sender según el entorno: Meta si hay credenciales; si no, no-op (degrada elegante). */
export function whatsappSenderFromEnv(env: Record<string, string | undefined>): WhatsAppSender {
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !accessToken) return noopWhatsAppSender();
  return metaWhatsAppSender({ phoneNumberId, accessToken });
}
