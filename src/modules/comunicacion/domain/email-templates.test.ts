import { describe, expect, it } from "vitest";

import { escapeHtml, renderInvitationEmail, renderWelcomeEmail } from "./email-templates";

const brand = { orgName: "Seminarea", primaryColor: "#1e3a8a" };

describe("escapeHtml", () => {
  it("escapa caracteres peligrosos", () => {
    expect(escapeHtml('<script>"x"&\'')).toBe("&lt;script&gt;&quot;x&quot;&amp;&#39;");
  });
});

describe("renderInvitationEmail", () => {
  const email = renderInvitationEmail({ brand, recipientName: "Ana", acceptUrl: "https://seminarea.chilearning.cl/activar?t=abc" });

  it("tiene asunto, html y texto con el nombre y la organización", () => {
    expect(email.subject).toContain("Seminarea");
    expect(email.html).toContain("Ana");
    expect(email.html).toContain("Seminarea");
    expect(email.text).toContain("https://seminarea.chilearning.cl/activar?t=abc");
  });

  it("aplica el color de marca al botón", () => {
    expect(email.html).toContain("#1e3a8a");
  });

  it("escapa un nombre malicioso (anti-inyección)", () => {
    const evil = renderInvitationEmail({ brand, recipientName: "<script>alert(1)</script>", acceptUrl: "https://x.cl" });
    expect(evil.html).not.toContain("<script>alert(1)</script>");
    expect(evil.html).toContain("&lt;script&gt;");
  });

  it("un color de marca inválido cae a un color seguro", () => {
    const e = renderInvitationEmail({ brand: { orgName: "X", primaryColor: "javascript:evil" }, recipientName: "A", acceptUrl: "https://x.cl" });
    expect(e.html).not.toContain("javascript:evil");
    expect(e.html).toContain("#1e3a8a");
  });
});

describe("renderWelcomeEmail", () => {
  const email = renderWelcomeEmail({ brand, recipientName: "Juan", courseName: "Prevención de riesgos", courseUrl: "https://seminarea.chilearning.cl/mi-curso" });

  it("incluye la guía de Clave Única y el curso", () => {
    expect(email.html).toContain("Clave Única");
    expect(email.html).toContain("Prevención de riesgos");
    expect(email.html).toContain("claveunica.gob.cl");
    expect(email.text).toContain("Registrar asistencia SENCE");
  });

  it("menciona que hay que registrar cada vez", () => {
    expect(email.html.toLowerCase()).toContain("cada vez");
  });
});
