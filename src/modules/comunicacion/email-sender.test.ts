import { describe, expect, it } from "vitest";

import {
  buildResendRequest,
  DEFAULT_MAIL_FROM,
  emailSenderFromEnv,
  maskEmail,
  noopEmailSender,
  resendEmailSender,
  type OutgoingEmail,
} from "./email-sender";

const EMAIL: OutgoingEmail = {
  to: "ana@ejemplo.cl",
  subject: "Bienvenida",
  html: "<p>Hola</p>",
  text: "Hola",
};

describe("maskEmail (minimización en logs, Ley 21.719)", () => {
  it("enmascara el local-part y preserva el dominio", () => {
    expect(maskEmail("juan.perez@otec.cl")).toBe("j***@otec.cl");
  });
  it("no revienta con entradas raras", () => {
    expect(maskEmail("")).toBe("***");
    expect(maskEmail("@dominio.cl")).toBe("***");
  });
});

describe("buildResendRequest (puro)", () => {
  it("arma el POST correcto con Bearer y body Resend", () => {
    const { url, init } = buildResendRequest(EMAIL, { apiKey: "re_test", from: "X <a@b.cl>" });
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      from: "X <a@b.cl>",
      to: ["ana@ejemplo.cl"],
      subject: "Bienvenida",
      html: "<p>Hola</p>",
      text: "Hola",
    });
  });

  it("omite text cuando no viene", () => {
    const { init } = buildResendRequest({ ...EMAIL, text: undefined }, { apiKey: "k", from: "f" });
    expect(JSON.parse(init.body as string)).not.toHaveProperty("text");
  });
});

describe("resendEmailSender (fetch inyectado — jamás la API real)", () => {
  it("2xx → ok con id", async () => {
    const sender = resendEmailSender({
      apiKey: "k",
      from: "f",
      fetchImpl: async () => new Response(JSON.stringify({ id: "email_123" }), { status: 200 }),
    });
    expect(await sender.send(EMAIL)).toEqual({ ok: true, id: "email_123" });
  });

  it("4xx → ok:false con el status (sin lanzar)", async () => {
    const sender = resendEmailSender({
      apiKey: "k",
      from: "f",
      fetchImpl: async () => new Response("{}", { status: 422 }),
    });
    expect(await sender.send(EMAIL)).toEqual({ ok: false, error: "resend_http_422" });
  });

  it("fallo de red → ok:false network_error (sin lanzar)", async () => {
    const sender = resendEmailSender({
      apiKey: "k",
      from: "f",
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      },
    });
    expect(await sender.send(EMAIL)).toEqual({ ok: false, error: "network_error" });
  });
});

describe("emailSenderFromEnv (degrada elegante sin proveedor)", () => {
  it("sin RESEND_API_KEY → sender no-op que reporta not_configured", async () => {
    const sender = emailSenderFromEnv({});
    expect(sender.configured).toBe(false);
    expect(await sender.send(EMAIL)).toEqual({ ok: false, error: "not_configured" });
  });

  it("con key → sender configurado (Resend) con MAIL_FROM o el default", () => {
    expect(emailSenderFromEnv({ RESEND_API_KEY: "re_x" }).configured).toBe(true);
    expect(emailSenderFromEnv({ RESEND_API_KEY: " " }).configured).toBe(false);
    expect(DEFAULT_MAIL_FROM).toContain("@chilearning.cl");
  });

  it("el no-op nunca lanza", async () => {
    await expect(noopEmailSender().send(EMAIL)).resolves.toMatchObject({ ok: false });
  });
});
