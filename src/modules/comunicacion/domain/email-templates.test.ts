import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  renderCertificateExpiringEmail,
  renderCompanyDigestEmail,
  renderExportFailedEmail,
  renderExportReadyEmail,
  renderInvitationEmail,
  renderReminderEmail,
  renderWelcomeEmail,
} from "./email-templates";

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

describe("renderCertificateExpiringEmail (task 5.12, HU-7.3)", () => {
  const base = {
    brand,
    recipientName: "Ana",
    courseName: "Trabajo en altura física",
    expiresOn: "15-10-2026",
    certificatesUrl: "https://seminarea.chilearning.cl/mi-curso/certificados",
  };

  it("dice el curso, la fecha y lleva el enlace absoluto a mis certificados", () => {
    const email = renderCertificateExpiringEmail({ ...base, daysLeft: 30 });
    expect(email.subject).toContain("Trabajo en altura física");
    expect(email.html).toContain("Trabajo en altura física");
    expect(email.html).toContain("15-10-2026");
    expect(email.html).toContain("https://seminarea.chilearning.cl/mi-curso/certificados");
    expect(email.text).toContain("https://seminarea.chilearning.cl/mi-curso/certificados");
  });

  it("conjuga bien el plazo: 30 días / 1 día / hoy", () => {
    expect(renderCertificateExpiringEmail({ ...base, daysLeft: 30 }).subject).toContain("en 30 días");
    expect(renderCertificateExpiringEmail({ ...base, daysLeft: 1 }).subject).toContain("en 1 día");
    expect(renderCertificateExpiringEmail({ ...base, daysLeft: 0 }).subject).toContain("hoy");
  });

  it("★ NO lleva folio ni RUN: el dato vive tras el login, no en la bandeja (Ley 21.719)", () => {
    const email = renderCertificateExpiringEmail({ ...base, daysLeft: 60 });
    const all = email.html + email.text;
    expect(all).not.toContain("CERT-");
    expect(all).not.toMatch(/\d{7,8}-[\dkK]/);
  });

  it("escapa un nombre de curso malicioso (anti-inyección)", () => {
    const evil = renderCertificateExpiringEmail({ ...base, courseName: "<script>alert(1)</script>", daysLeft: 10 });
    expect(evil.html).not.toContain("<script>alert(1)</script>");
    expect(evil.html).toContain("&lt;script&gt;");
  });
});

describe("renderReminderEmail (task 3.9, HU-5.9 — personalización 5.9)", () => {
  const base = {
    brand,
    recipientName: "Ana",
    courseName: "Prevención de riesgos",
    courseUrl: "https://seminarea.chilearning.cl/mi-curso",
  };

  it("kind:inactive CON lastActivityDaysAgo -> incluye la frase con el número correcto", () => {
    const email = renderReminderEmail({ ...base, kind: "inactive", lastActivityDaysAgo: 9 });
    expect(email.html).toContain("Han pasado 9 días desde tu última actividad en el curso.");
    expect(email.text).toContain("Han pasado 9 días desde tu última actividad en el curso.");
  });

  it("conjuga singular cuando es 1 día", () => {
    const email = renderReminderEmail({ ...base, kind: "inactive", lastActivityDaysAgo: 1 });
    expect(email.html).toContain("Han pasado 1 día desde tu última actividad en el curso.");
  });

  it("kind:no_attendance NO cambia aunque venga lastActivityDaysAgo (no aplica a ese camino)", () => {
    const withField = renderReminderEmail({ ...base, kind: "no_attendance", lastActivityDaysAgo: 9 });
    const without = renderReminderEmail({ ...base, kind: "no_attendance" });
    expect(withField).toEqual(without);
    expect(withField.html).not.toContain("última actividad");
  });

  it("kind:inactive SIN lastActivityDaysAgo (undefined) -> comportamiento IDÉNTICO al previo (sin la frase)", () => {
    const email = renderReminderEmail({ ...base, kind: "inactive" });
    expect(email.html).not.toContain("última actividad");
    expect(email.text).not.toContain("última actividad");
  });
});

describe("renderCompanyDigestEmail (task 5.9, HU-8.2)", () => {
  const base = {
    brand,
    razonSocial: "Pesquera Demo del Sur Ltda",
    weekStart: "13-07-2026",
    narrative: "El avance de la semana fue sólido, sin riesgos relevantes.",
    workers: 12,
    actions: 2,
    lessonsCompletedInPeriod: 34,
    attendanceDaysInPeriod: 40,
    gradesPublishedInPeriod: 3,
    certificatesIssuedInPeriod: 1,
    portalUrl: "https://seminarea.chilearning.cl/empresa",
  };

  it("saluda con la razón social y muestra los 6 conteos + la narrativa", () => {
    const email = renderCompanyDigestEmail(base);
    expect(email.subject).toContain("Pesquera Demo del Sur Ltda");
    expect(email.html).toContain("Pesquera Demo del Sur Ltda");
    expect(email.html).toContain("El avance de la semana fue sólido");
    expect(email.html).toContain("<strong>12</strong>");
    expect(email.html).toContain("<strong>34</strong>");
    expect(email.text).toContain("Trabajadores vinculados: 12");
  });

  it("enlaza al portal de la empresa", () => {
    const email = renderCompanyDigestEmail(base);
    expect(email.html).toContain(base.portalUrl);
    expect(email.text).toContain(base.portalUrl);
  });

  it("escapa una razón social y una narrativa maliciosas (anti-inyección)", () => {
    const evil = renderCompanyDigestEmail({
      ...base,
      razonSocial: "<script>alert(1)</script>",
      narrative: "<img src=x onerror=alert(1)>",
    });
    expect(evil.html).not.toContain("<script>alert(1)</script>");
    expect(evil.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(evil.html).toContain("&lt;script&gt;");
  });
});

describe("renderExportReadyEmail / renderExportFailedEmail (task 5.13)", () => {
  const params = {
    brand,
    recipientName: "Ana",
    exportPageUrl: "https://seminarea.chilearning.cl/admin/exportacion",
  };

  it("el aviso de listo enlaza a la PÁGINA del export, no a un archivo", () => {
    const email = renderExportReadyEmail(params);
    expect(email.subject).toContain("Seminarea");
    expect(email.html).toContain(params.exportPageUrl);
    expect(email.text).toContain(params.exportPageUrl);
    expect(email.html).not.toContain(".zip");
  });

  it("el aviso de fallo invita a reintentar y enlaza a la misma página", () => {
    const email = renderExportFailedEmail(params);
    expect(email.subject.toLowerCase()).toContain("no se pudo");
    expect(email.html).toContain(params.exportPageUrl);
  });
});
