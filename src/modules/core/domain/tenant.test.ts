import { describe, expect, it } from "vitest";

import {
  isReservedSlug,
  isValidTenantSlug,
  resolveTenantFromHost,
  RESERVED_SLUGS,
} from "@/modules/core/domain/tenant";

const ROOT = "chilearning.cl";

describe("isValidTenantSlug", () => {
  it("acepta slugs válidos", () => {
    expect(isValidTenantSlug("seminarea")).toBe(true);
    expect(isValidTenantSlug("abc")).toBe(true);
    expect(isValidTenantSlug("a1b2c3")).toBe(true);
  });

  it("rechaza demasiado cortos, con mayúsculas, guiones al borde o caracteres inválidos", () => {
    expect(isValidTenantSlug("ab")).toBe(false);
    expect(isValidTenantSlug("Otec")).toBe(false);
    expect(isValidTenantSlug("-otec")).toBe(false);
    expect(isValidTenantSlug("otec-")).toBe(false);
    expect(isValidTenantSlug("semi_narea")).toBe(false);
    expect(isValidTenantSlug("a".repeat(31))).toBe(false);
  });

  it("rechaza slugs reservados aunque tengan formato válido", () => {
    for (const s of RESERVED_SLUGS) {
      expect(isValidTenantSlug(s)).toBe(false);
      expect(isReservedSlug(s)).toBe(true);
    }
  });
});

describe("resolveTenantFromHost", () => {
  it("extrae el slug de un subdominio de tenant", () => {
    expect(resolveTenantFromHost("seminarea.chilearning.cl", ROOT)).toEqual({
      slug: "seminarea",
      isRootDomain: false,
      isReserved: false,
    });
  });

  it("tolera el puerto y las mayúsculas", () => {
    expect(resolveTenantFromHost("SeminArea.Chilearning.CL:3000", ROOT).slug).toBe("seminarea");
  });

  it("detecta el dominio raíz sin subdominio", () => {
    const r = resolveTenantFromHost("chilearning.cl", ROOT);
    expect(r.isRootDomain).toBe(true);
    expect(r.slug).toBeNull();
  });

  it("marca los subdominios reservados como no-tenant", () => {
    const r = resolveTenantFromHost("admin.chilearning.cl", ROOT);
    expect(r.isReserved).toBe(true);
    expect(r.slug).toBeNull();
  });

  it("no confunde un sub-subdominio con un tenant", () => {
    expect(resolveTenantFromHost("a.b.chilearning.cl", ROOT).slug).toBeNull();
  });

  it("ignora hosts ajenos al dominio raíz (acceso por IP)", () => {
    expect(resolveTenantFromHost("216.185.51.57", ROOT).slug).toBeNull();
    expect(resolveTenantFromHost("otec.otrodominio.cl", ROOT).slug).toBeNull();
  });

  it("rechaza un subdominio con formato de slug inválido", () => {
    expect(resolveTenantFromHost("ab.chilearning.cl", ROOT).slug).toBeNull();
    expect(resolveTenantFromHost("-x-.chilearning.cl", ROOT).slug).toBeNull();
  });

  it("maneja host/rootDomain vacíos sin romper", () => {
    expect(resolveTenantFromHost(null, ROOT).slug).toBeNull();
    expect(resolveTenantFromHost("otec.chilearning.cl", "").slug).toBeNull();
  });

  it("funciona con dominios de desarrollo/sslip", () => {
    expect(resolveTenantFromHost("seminarea.localtest.me", "localtest.me").slug).toBe("seminarea");
    expect(
      resolveTenantFromHost("demo.216.185.51.57.sslip.io", "216.185.51.57.sslip.io").slug,
    ).toBe("demo");
  });
});
