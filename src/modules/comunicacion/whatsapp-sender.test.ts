import { describe, expect, it, vi } from "vitest";

import {
  buildWhatsAppRequest,
  maskPhone,
  metaWhatsAppSender,
  noopWhatsAppSender,
  whatsappSenderFromEnv,
  type OutgoingWhatsApp,
} from "./whatsapp-sender";

const MSG: OutgoingWhatsApp = {
  to: "+56912345678",
  templateName: "recordatorio_asistencia_v1",
  languageCode: "es",
  bodyParams: ["Ana", "Curso 1"],
};

describe("maskPhone (minimización en logs, Ley 21.719)", () => {
  it("conserva un prefijo y sufijo cortos, oculta el resto", () => {
    expect(maskPhone("+56912345678")).toBe("+56***678");
  });

  it("funciona sin el +56 (solo dígitos)", () => {
    expect(maskPhone("56912345678")).toBe("569***678");
  });

  it("funciona con espacios (formato humano)", () => {
    expect(maskPhone("+56 9 1234 5678")).toBe("+56***678");
  });

  it("nunca revela el número completo aunque sea corto", () => {
    expect(maskPhone("123")).toBe("***");
    expect(maskPhone("")).toBe("***");
  });
});

describe("buildWhatsAppRequest (puro)", () => {
  it("arma el POST correcto con Bearer y el body de plantilla de Meta", () => {
    const { url, init } = buildWhatsAppRequest(MSG, { phoneNumberId: "1234567890", accessToken: "tok" });
    expect(url).toBe("https://graph.facebook.com/v21.0/1234567890/messages");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "+56912345678",
      type: "template",
      template: {
        name: "recordatorio_asistencia_v1",
        language: { code: "es" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Ana" },
              { type: "text", text: "Curso 1" },
            ],
          },
        ],
      },
    });
  });
});

describe("metaWhatsAppSender (fetch inyectado — jamás la API real)", () => {
  it("2xx → ok con id del mensaje", async () => {
    const sender = metaWhatsAppSender({
      phoneNumberId: "1",
      accessToken: "tok",
      fetchImpl: async () =>
        new Response(JSON.stringify({ messages: [{ id: "wamid.abc" }] }), { status: 200 }),
    });
    expect(await sender.send(MSG)).toEqual({ ok: true, id: "wamid.abc" });
  });

  it("4xx → ok:false con el status (sin lanzar)", async () => {
    const sender = metaWhatsAppSender({
      phoneNumberId: "1",
      accessToken: "tok",
      fetchImpl: async () => new Response("{}", { status: 401 }),
    });
    expect(await sender.send(MSG)).toEqual({ ok: false, error: "meta_http_401" });
  });

  it("fallo de red → ok:false network_error (sin lanzar)", async () => {
    const sender = metaWhatsAppSender({
      phoneNumberId: "1",
      accessToken: "tok",
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      },
    });
    expect(await sender.send(MSG)).toEqual({ ok: false, error: "network_error" });
  });

  it("nunca loguea el número completo", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sender = metaWhatsAppSender({
      phoneNumberId: "1",
      accessToken: "tok",
      fetchImpl: async () => new Response("{}", { status: 500 }),
    });
    await sender.send(MSG);
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain(MSG.to);
    spy.mockRestore();
  });
});

describe("whatsappSenderFromEnv (degrada elegante sin credenciales)", () => {
  it("sin credenciales → sender no-op que reporta not_configured", async () => {
    const sender = whatsappSenderFromEnv({});
    expect(sender.configured).toBe(false);
    expect(await sender.send(MSG)).toEqual({ ok: false, error: "not_configured" });
  });

  it("con solo una de las dos vars → sigue no-op", () => {
    expect(whatsappSenderFromEnv({ WHATSAPP_PHONE_NUMBER_ID: "123" }).configured).toBe(false);
    expect(whatsappSenderFromEnv({ WHATSAPP_ACCESS_TOKEN: "tok" }).configured).toBe(false);
  });

  it("con ambas vars → sender configurado (Meta)", () => {
    expect(
      whatsappSenderFromEnv({ WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_ACCESS_TOKEN: "tok" }).configured,
    ).toBe(true);
    // vars en blanco cuentan como ausentes
    expect(whatsappSenderFromEnv({ WHATSAPP_PHONE_NUMBER_ID: " ", WHATSAPP_ACCESS_TOKEN: "tok" }).configured).toBe(
      false,
    );
  });

  it("el no-op nunca llama fetch ni toca red", async () => {
    const fetchSpy = vi.fn();
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await expect(noopWhatsAppSender().send(MSG)).resolves.toMatchObject({ ok: false });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});
