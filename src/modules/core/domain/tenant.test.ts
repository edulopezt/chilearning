import { describe, expect, it } from "vitest";

import { FEATURE_KEYS } from "@/modules/core/domain/features";
import {
  createTenantSchema,
  DEFAULT_TENANT_FLAGS,
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
    // Guion interior permitido (tenant B real del seed depende de esto).
    expect(isValidTenantSlug("otec-pacifico")).toBe(true);
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

describe("createTenantSchema (task 5.3, HU-1.1)", () => {
  const base = {
    name: "OTEC de Prueba SpA",
    slug: "otec-prueba",
    plan: "standard",
    adminEmail: "admin@otec-prueba.test",
  };

  it("acepta una entrada válida (rut opcional)", () => {
    const r = createTenantSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rut).toBeNull();
    expect(createTenantSchema.safeParse({ ...base, rut: "76123456-7" }).success).toBe(true);
  });

  it("rechaza slugs reservados aunque el formato sea válido", () => {
    expect(createTenantSchema.safeParse({ ...base, slug: "admin" }).success).toBe(false);
    expect(createTenantSchema.safeParse({ ...base, slug: "staging" }).success).toBe(false);
  });

  it("rechaza slug de 2 caracteres", () => {
    expect(createTenantSchema.safeParse({ ...base, slug: "ab" }).success).toBe(false);
  });

  it("rechaza slug de 31 caracteres", () => {
    expect(createTenantSchema.safeParse({ ...base, slug: "a".repeat(31) }).success).toBe(false);
  });

  it("rechaza mayúsculas y guiones al borde", () => {
    expect(createTenantSchema.safeParse({ ...base, slug: "Otec" }).success).toBe(false);
    expect(createTenantSchema.safeParse({ ...base, slug: "-otec" }).success).toBe(false);
  });

  it("rechaza un plan inválido", () => {
    expect(createTenantSchema.safeParse({ ...base, plan: "premium" }).success).toBe(false);
    expect(createTenantSchema.safeParse({ ...base, plan: "" }).success).toBe(false);
  });

  it("rechaza correo inválido y nombre vacío", () => {
    expect(createTenantSchema.safeParse({ ...base, adminEmail: "no-es-correo" }).success).toBe(false);
    expect(createTenantSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
  });

  it("rechaza un rut de más de 12 caracteres", () => {
    expect(createTenantSchema.safeParse({ ...base, rut: "7".repeat(13) }).success).toBe(false);
  });
});

describe("DEFAULT_TENANT_FLAGS (HU-1.3: configuración por defecto segura)", () => {
  it("cubre exactamente las claves del contrato, todas apagadas", () => {
    expect(Object.keys(DEFAULT_TENANT_FLAGS).sort()).toEqual([...FEATURE_KEYS].sort());
    for (const key of FEATURE_KEYS) expect(DEFAULT_TENANT_FLAGS[key]).toBe(false);
  });
});

describe("resolveTenantFromHost", () => {
  it("extrae el slug de un subdominio de tenant", () => {
    expect(resolveTenantFromHost("seminarea.chilearning.cl", ROOT)).toEqual({
      slug: "seminarea",
      isRootDomain: false,
      isReserved: false,
    });
    // Slug con guion interior (tenant B del seed).
    expect(resolveTenantFromHost("otec-pacifico.chilearning.cl", ROOT).slug).toBe("otec-pacifico");
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
