/**
 * Dominio del tablero superadmin (task 5.5, HU-10.3). Datos 100% ficticios.
 */
import { describe, expect, it } from "vitest";

import { sortForBoard, summarize, type TenantStatsRow } from "@/modules/plataforma/domain/overview";

function row(over: Partial<TenantStatsRow> & { slug: string }): TenantStatsRow {
  return {
    tenantId: `00000000-0000-4000-8000-0000000000${over.slug.length}`,
    name: `OTEC ${over.slug}`,
    plan: "standard",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    students: 0,
    enrollments: 0,
    actions: 0,
    courses: 0,
    certificates: 0,
    openAlerts: 0,
    senceErrorAlerts7d: 0,
    lastEnrollmentAt: null,
    ...over,
  };
}

describe("summarize", () => {
  it("suma alumnos, inscripciones y alertas de todos los tenants", () => {
    const rows = [
      row({ slug: "alfa", students: 10, enrollments: 25, openAlerts: 2 }),
      row({ slug: "beta", students: 5, enrollments: 7, openAlerts: 1 }),
    ];
    expect(summarize(rows)).toEqual({
      totalTenants: 2,
      active: 2,
      suspended: 0,
      totalStudents: 15,
      totalEnrollments: 32,
      openAlerts: 3,
    });
  });

  it("separa activos de suspendidos", () => {
    const rows = [
      row({ slug: "alfa" }),
      row({ slug: "beta", status: "suspended" }),
      row({ slug: "gama", status: "suspended" }),
    ];
    const s = summarize(rows);
    expect(s.totalTenants).toBe(3);
    expect(s.active).toBe(1);
    expect(s.suspended).toBe(2);
  });

  it("lista vacía => todo en cero (no NaN ni undefined)", () => {
    expect(summarize([])).toEqual({
      totalTenants: 0,
      active: 0,
      suspended: 0,
      totalStudents: 0,
      totalEnrollments: 0,
      openAlerts: 0,
    });
  });
});

describe("sortForBoard", () => {
  it("suspendidos primero, luego con alertas, luego por inscripciones desc", () => {
    const rows = [
      row({ slug: "tranquila", enrollments: 100 }),
      row({ slug: "con-alertas", enrollments: 5, openAlerts: 3 }),
      row({ slug: "suspendida", enrollments: 1, status: "suspended" }),
      row({ slug: "mediana", enrollments: 50 }),
    ];
    expect(sortForBoard(rows).map((r) => r.slug)).toEqual([
      "suspendida",
      "con-alertas",
      "tranquila",
      "mediana",
    ]);
  });

  it("un tenant suspendido CON alertas sigue primero (la suspensión manda)", () => {
    const rows = [
      row({ slug: "alertada", openAlerts: 9, enrollments: 900 }),
      row({ slug: "suspendida", status: "suspended", openAlerts: 1, enrollments: 1 }),
    ];
    expect(sortForBoard(rows).map((r) => r.slug)).toEqual(["suspendida", "alertada"]);
  });

  it("empate de rango e inscripciones => orden estable por slug", () => {
    const rows = [row({ slug: "zeta" }), row({ slug: "alfa" }), row({ slug: "mika" })];
    expect(sortForBoard(rows).map((r) => r.slug)).toEqual(["alfa", "mika", "zeta"]);
  });

  it("no muta el arreglo de entrada", () => {
    const rows = [row({ slug: "alfa", enrollments: 1 }), row({ slug: "beta", enrollments: 9 })];
    const before = rows.map((r) => r.slug);
    sortForBoard(rows);
    expect(rows.map((r) => r.slug)).toEqual(before);
  });

  it("lista vacía => lista vacía", () => {
    expect(sortForBoard([])).toEqual([]);
  });
});
