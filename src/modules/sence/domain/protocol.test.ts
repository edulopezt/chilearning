import { describe, expect, it } from "vitest";

import {
  buildIdSesionAlumno,
  computeDedupeHash,
  parseFechaHora,
  resolveEndpoint,
  resolvePublicOrigin,
  stripToken,
} from "@/modules/sence/domain/protocol";

describe("resolveEndpoint", () => {
  it("resuelve rcetest y rce para inicio y cierre", () => {
    expect(resolveEndpoint("rcetest", "start")).toBe(
      "https://sistemas.sence.cl/rcetest/Registro/IniciarSesion",
    );
    expect(resolveEndpoint("rce", "close")).toBe(
      "https://sistemas.sence.cl/rce/Registro/CerrarSesion",
    );
  });

  it("acepta una base override (para el mock)", () => {
    expect(resolveEndpoint("rcetest", "start", "http://127.0.0.1:4010/rcetest")).toBe(
      "http://127.0.0.1:4010/rcetest/Registro/IniciarSesion",
    );
  });
});

describe("computeDedupeHash (I-3, sobre el payload completo)", () => {
  it("es determinista para el mismo payload y kind (orden de claves indiferente)", () => {
    const a = computeDedupeHash({ IdSesionAlumno: "a", IdSesionSence: "s" }, "start_ok");
    const b = computeDedupeHash({ IdSesionSence: "s", IdSesionAlumno: "a" }, "start_ok");
    expect(a).toBe(b);
  });

  it("difiere si cambia el kind o cualquier campo del payload", () => {
    const p = { IdSesionAlumno: "a" };
    expect(computeDedupeHash(p, "start_ok")).not.toBe(computeDedupeHash(p, "start_error"));
    expect(computeDedupeHash(p, "start_ok")).not.toBe(
      computeDedupeHash({ ...p, GlosaError: "211" }, "start_ok"),
    );
  });

  it("ignora el Token si por error viniera en el payload (I-7)", () => {
    const withToken = computeDedupeHash({ IdSesionAlumno: "a", Token: "x" }, "start_ok");
    const without = computeDedupeHash({ IdSesionAlumno: "a" }, "start_ok");
    expect(withToken).toBe(without);
  });
});

describe("buildIdSesionAlumno", () => {
  it("prefija y respeta el largo máximo 149", () => {
    const id = buildIdSesionAlumno("11111111-1111-4111-8111-111111111111");
    expect(id.startsWith("chl-")).toBe(true);
    expect(id.length).toBeLessThanOrEqual(149);
  });
});

describe("stripToken (I-7)", () => {
  it("elimina Token en cualquier capitalización", () => {
    expect(stripToken({ RunAlumno: "1-9", Token: "secreto" })).toEqual({ RunAlumno: "1-9" });
    expect(stripToken({ token: "x", a: 1 })).toEqual({ a: 1 });
    expect(stripToken({ TOKEN: "x", b: 2 })).toEqual({ b: 2 });
  });
});

describe("parseFechaHora", () => {
  it("parsea el formato de SENCE", () => {
    expect(parseFechaHora("2026-07-14 10:30:00")).toBe(Date.parse("2026-07-14T10:30:00"));
  });
  it("tolera ausencia y formato inválido", () => {
    expect(parseFechaHora(null)).toBeNull();
    expect(parseFechaHora("ayer")).toBeNull();
  });
});

describe("resolvePublicOrigin (callback detrás de proxy, anti-spoofing)", () => {
  const ROOT = "chilearning.cl";
  const h = (map: Record<string, string>) => (n: string) => map[n.toLowerCase()] ?? null;

  it("usa x-forwarded-host cuando es un subdominio del root, forzando https", () => {
    const origin = resolvePublicOrigin(
      h({ "x-forwarded-proto": "http", "x-forwarded-host": "seminarea.chilearning.cl", host: "internal:3000" }),
      "http://internal:3000/api/sence/start",
      ROOT,
    );
    // esquema forzado a https aunque el proxy diga http
    expect(origin).toBe("https://seminarea.chilearning.cl");
  });

  it("acepta el propio dominio raíz", () => {
    expect(resolvePublicOrigin(h({ host: "chilearning.cl" }), "http://internal/x", ROOT)).toBe(
      "https://chilearning.cl",
    );
  });

  it("RECHAZA un host externo forjado (open-redirect) y cae al fallback", () => {
    const origin = resolvePublicOrigin(
      h({ "x-forwarded-host": "evil.com", "x-forwarded-proto": "https" }),
      "https://seminarea.chilearning.cl/api/sence/start",
      ROOT,
    );
    expect(origin).toBe("https://seminarea.chilearning.cl");
  });

  it("no se deja engañar por userinfo (evil.com@otec...) ni por path inyectado", () => {
    expect(
      resolvePublicOrigin(h({ "x-forwarded-host": "evil.com@sub.chilearning.cl" }), "http://internal/x", ROOT),
    ).toBe("https://sub.chilearning.cl");
    expect(
      resolvePublicOrigin(h({ "x-forwarded-host": "evil.com/path" }), "https://ok.chilearning.cl/x", ROOT),
    ).toBe("https://ok.chilearning.cl");
  });

  it("no confunde un sufijo pegado (evilchilearning.cl) con un subdominio", () => {
    expect(
      resolvePublicOrigin(h({ "x-forwarded-host": "evilchilearning.cl" }), "https://ok.chilearning.cl/x", ROOT),
    ).toBe("https://ok.chilearning.cl");
  });

  it("toma el primer valor de listas separadas por coma", () => {
    const origin = resolvePublicOrigin(
      h({ "x-forwarded-host": "seminarea.chilearning.cl, evil.com" }),
      "http://internal/x",
      ROOT,
    );
    expect(origin).toBe("https://seminarea.chilearning.cl");
  });

  it("cae al Host header si no hay x-forwarded-host", () => {
    expect(
      resolvePublicOrigin(h({ host: "seminarea.chilearning.cl" }), "http://internal/x", ROOT),
    ).toBe("https://seminarea.chilearning.cl");
  });

  it("sin headers de proxy, usa el origin de la URL cruda", () => {
    expect(resolvePublicOrigin(h({}), "https://directo.chilearning.cl/api/sence/start", ROOT)).toBe(
      "https://directo.chilearning.cl",
    );
  });
});
