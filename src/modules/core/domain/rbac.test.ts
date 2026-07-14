import { describe, expect, it } from "vitest";

import {
  authorize,
  canActInTenant,
  hasAnyRole,
  isSuperadmin,
  principalFromClaims,
  type Principal,
} from "@/modules/core/domain/rbac";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const superadmin: Principal = { userId: "s", tenantId: null, roles: ["superadmin"] };
const adminA: Principal = { userId: "a", tenantId: TENANT_A, roles: ["otec_admin"] };
const studentA: Principal = { userId: "st", tenantId: TENANT_A, roles: ["student"] };
const noRoles: Principal = { userId: "x", tenantId: TENANT_A, roles: [] };

describe("principalFromClaims", () => {
  it("descarta roles desconocidos y claims malformados", () => {
    const p = principalFromClaims({
      sub: "u1",
      tenant_id: TENANT_A,
      roles: ["otec_admin", "hacker", 42, "superadmin"],
    });
    expect(p.userId).toBe("u1");
    expect(p.tenantId).toBe(TENANT_A);
    expect(p.roles).toEqual(["otec_admin", "superadmin"]);
  });

  it("un roles no-array degrada a vacío (falla cerrado)", () => {
    const p = principalFromClaims({ sub: "u", tenant_id: TENANT_A, roles: "otec_admin" });
    expect(p.roles).toEqual([]);
  });

  it("tenant_id ausente o vacío → null", () => {
    expect(principalFromClaims({ sub: "u", roles: [] }).tenantId).toBeNull();
    expect(principalFromClaims({ sub: "u", tenant_id: "", roles: [] }).tenantId).toBeNull();
  });
});

describe("canActInTenant", () => {
  it("superadmin actúa en cualquier tenant", () => {
    expect(canActInTenant(superadmin, TENANT_A)).toBe(true);
    expect(canActInTenant(superadmin, TENANT_B)).toBe(true);
  });

  it("un usuario solo actúa en su tenant activo", () => {
    expect(canActInTenant(adminA, TENANT_A)).toBe(true);
    expect(canActInTenant(adminA, TENANT_B)).toBe(false);
  });

  it("sin roles no actúa en ningún tenant (deny-by-default)", () => {
    expect(canActInTenant(noRoles, TENANT_A)).toBe(false);
  });
});

describe("authorize (deny-by-default)", () => {
  it("otec_admin accede a un recurso permitido a su rol", () => {
    expect(authorize(adminA, TENANT_A, ["otec_admin", "coordinator"])).toBe(true);
  });

  it("student NO accede a un recurso solo de admin/coordinador", () => {
    expect(authorize(studentA, TENANT_A, ["otec_admin", "coordinator"])).toBe(false);
  });

  it("otec_admin del tenant A no accede a un recurso del tenant B", () => {
    expect(authorize(adminA, TENANT_B, ["otec_admin"])).toBe(false);
  });

  it("superadmin pasa cualquier autorización", () => {
    expect(authorize(superadmin, TENANT_A, ["otec_admin"])).toBe(true);
    expect(authorize(superadmin, TENANT_B, ["student"])).toBe(true);
  });

  it("lista de roles permitidos vacía → nadie pasa (salvo superadmin)", () => {
    expect(authorize(adminA, TENANT_A, [])).toBe(false);
    expect(authorize(superadmin, TENANT_A, [])).toBe(true);
  });
});

describe("helpers", () => {
  it("isSuperadmin / hasAnyRole", () => {
    expect(isSuperadmin(superadmin)).toBe(true);
    expect(isSuperadmin(adminA)).toBe(false);
    expect(hasAnyRole(adminA, ["coordinator", "otec_admin"])).toBe(true);
    expect(hasAnyRole(studentA, ["coordinator", "otec_admin"])).toBe(false);
  });
});
