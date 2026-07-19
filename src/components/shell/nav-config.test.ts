import { describe, expect, it } from "vitest";

import { navForRoles } from "./nav-config";

function keysOf(roles: Parameters<typeof navForRoles>[0]["roles"]): string[] {
  return navForRoles({ roles }).map((a) => a.key);
}

describe("navForRoles", () => {
  it("sin roles: ninguna área", () => {
    expect(navForRoles({ roles: [] })).toEqual([]);
  });

  it("student: solo mi-curso", () => {
    expect(keysOf(["student"])).toEqual(["mi-curso"]);
  });

  it("coordinator: admin (recorte) + tablero, SIN sence/marca/correos", () => {
    const areas = navForRoles({ roles: ["coordinator"] });
    expect(areas.map((a) => a.key)).toEqual(["admin", "tablero"]);
    const adminHrefs = areas.find((a) => a.key === "admin")!.items.map((i) => i.href);
    expect(adminHrefs).toEqual(["/admin/cursos", "/admin/acciones", "/admin/inscripciones", "/admin/tutor-ia"]);
    expect(adminHrefs).not.toContain("/admin/sence");
    expect(adminHrefs).not.toContain("/admin/marca");
  });

  it("otec_admin: admin completo (incluye sence/marca/correos/derechos/exportación) + tablero", () => {
    const areas = navForRoles({ roles: ["otec_admin"] });
    const adminHrefs = areas.find((a) => a.key === "admin")!.items.map((i) => i.href);
    expect(adminHrefs).toEqual(
      expect.arrayContaining([
        "/admin/cursos",
        "/admin/sence",
        "/admin/marca",
        "/admin/correos",
        "/admin/certificados/vencimientos",
        "/admin/mensajes",
        "/admin/empresas",
        "/admin/supervisores",
        "/admin/derechos",
        "/admin/exportacion",
      ]),
    );
  });

  it("instructor/tutor: solo tablero (sin admin)", () => {
    expect(keysOf(["instructor"])).toEqual(["tablero"]);
    expect(keysOf(["tutor"])).toEqual(["tablero"]);
  });

  it("supervisor: solo su portal", () => {
    expect(keysOf(["supervisor"])).toEqual(["supervisor"]);
  });

  it("company: solo el portal de empresa (gap real del dashboard anterior, ahora cerrado)", () => {
    expect(keysOf(["company"])).toEqual(["empresa"]);
  });

  it("superadmin: solo su área (plataforma, no un tenant)", () => {
    const areas = navForRoles({ roles: ["superadmin"] });
    expect(areas.map((a) => a.key)).toEqual(["superadmin"]);
    expect(areas[0]!.items.map((i) => i.href)).toEqual(["/superadmin", "/superadmin/tenants"]);
  });

  it("roles múltiples: unión de áreas, en el orden estable de la función", () => {
    expect(keysOf(["student", "otec_admin"])).toEqual(["mi-curso", "admin", "tablero"]);
  });

  it("cada item de cada área tiene href, label no vacío e icon definido", () => {
    const allRoles = ["otec_admin", "coordinator", "instructor", "tutor", "student", "company", "supervisor", "superadmin"] as const;
    for (const area of navForRoles({ roles: allRoles })) {
      expect(area.href.startsWith("/")).toBe(true);
      expect(area.label.length).toBeGreaterThan(0);
      expect(area.icon).toBeDefined();
      for (const item of area.items) {
        expect(item.href.startsWith("/")).toBe(true);
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.icon).toBeDefined();
      }
    }
  });
});
