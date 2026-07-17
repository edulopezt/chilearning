import { describe, expect, it } from "vitest";

import {
  companyExportRowValues,
  companyPanelRows,
  createCompanySchema,
  inviteMemberSchema,
  isValidRut,
  normalizeRut,
  sanitizeXlsxCell,
  type CompanyCertLabels,
  type CompanyPanelInputs,
} from "@/modules/portal-empresa/domain/company";

/** Datos 100% FICTICIOS (CLAUDE.md): RUTs de empresa inventados con DV real. */

describe("RUT de empresa — normalización y DV módulo 11", () => {
  it("normaliza puntos, guión y espacios a la forma xxxxxxxx-x", () => {
    expect(normalizeRut("77.123.456-9")).toBe("77123456-9");
    expect(normalizeRut(" 77123456-9 ")).toBe("77123456-9");
    expect(normalizeRut("771234569")).toBe("77123456-9");
    // 'K' se normaliza a minúscula (formato de envío SENCE, I-8).
    expect(normalizeRut("12.345.670-K")).toBe("12345670-k");
  });

  it("acepta el DV correcto y rechaza el incorrecto", () => {
    expect(isValidRut("77123456-9")).toBe(true);
    expect(isValidRut("78654321-5")).toBe(true);
    // Mismo cuerpo, DV cambiado: debe caer.
    expect(isValidRut("77123456-8")).toBe(false);
    expect(isValidRut("78654321-4")).toBe(false);
  });

  it("rechaza formas no normalizadas o basura", () => {
    expect(isValidRut("77.123.456-9")).toBe(false); // con puntos no es la forma normativa
    expect(isValidRut("77123456")).toBe(false); // sin DV
    expect(isValidRut("")).toBe(false);
    expect(isValidRut("no-soy-un-rut")).toBe(false);
  });
});

describe("createCompanySchema", () => {
  it("acepta un RUT con puntos y lo devuelve normalizado", () => {
    const parsed = createCompanySchema.safeParse({
      rut: "77.123.456-9",
      razonSocial: "  Constructora Los Aromos Ltda  ",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.rut).toBe("77123456-9");
    expect(parsed.data.razonSocial).toBe("Constructora Los Aromos Ltda");
  });

  it("rechaza el DV incorrecto y la razón social vacía", () => {
    expect(createCompanySchema.safeParse({ rut: "77123456-8", razonSocial: "X" }).success).toBe(false);
    expect(createCompanySchema.safeParse({ rut: "77123456-9", razonSocial: "   " }).success).toBe(false);
  });
});

describe("inviteMemberSchema", () => {
  it("exige uuid de empresa y correo válido", () => {
    expect(
      inviteMemberSchema.safeParse({
        companyId: "c1000000-0000-4000-8000-000000000001",
        email: " rrhh@aromos.test ",
      }).success,
    ).toBe(true);
    expect(inviteMemberSchema.safeParse({ companyId: "no-uuid", email: "rrhh@aromos.test" }).success).toBe(false);
    expect(
      inviteMemberSchema.safeParse({ companyId: "c1000000-0000-4000-8000-000000000001", email: "no-es-correo" })
        .success,
    ).toBe(false);
  });
});

describe("sanitizeXlsxCell (D-021 para XLSX)", () => {
  it("prefija ' a los inicios que Excel evaluaría como fórmula", () => {
    expect(sanitizeXlsxCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(sanitizeXlsxCell("+1+1")).toBe("'+1+1");
    expect(sanitizeXlsxCell("-1")).toBe("'-1");
    expect(sanitizeXlsxCell("@cmd")).toBe("'@cmd");
    expect(sanitizeXlsxCell("\tx")).toBe("'\tx");
    expect(sanitizeXlsxCell("\rx")).toBe("'\rx");
  });

  it("deja intacto lo que no empieza con un carácter peligroso", () => {
    expect(sanitizeXlsxCell("Pérez Soto, María José")).toBe("Pérez Soto, María José");
    expect(sanitizeXlsxCell("")).toBe("");
    expect(sanitizeXlsxCell("12.XXX.XXX-X")).toBe("12.XXX.XXX-X");
    // El peligro es solo al INICIO de la celda.
    expect(sanitizeXlsxCell("a=b")).toBe("a=b");
  });
});

const E1 = "e0000000-0000-4000-8000-000000000001";
const E2 = "e0000000-0000-4000-8000-000000000002";

function inputs(over: Partial<CompanyPanelInputs> = {}): CompanyPanelInputs {
  return {
    enrollments: [
      { enrollmentId: E1, firstNames: "María José", lastNames: "Pérez Soto", run: "5126663-3", exento: false },
      { enrollmentId: E2, firstNames: "Ana", lastNames: "Bravo Lillo", run: "11222333-9", exento: false },
    ],
    totalLessons: 4,
    completedLessons: [],
    sessions: [],
    grades: new Map(),
    certificates: [],
    ...over,
  };
}

describe("companyPanelRows", () => {
  it("enmascara el RUN SIEMPRE y ordena por nombre", () => {
    const rows = companyPanelRows(inputs());
    expect(rows.map((r) => r.nombre)).toEqual(["Bravo Lillo, Ana", "Pérez Soto, María José"]);
    // Ningún RUN completo sobrevive a la fila.
    expect(rows.map((r) => r.runMasked)).toEqual(["11.XXX.XXX-X", "51.XXX.XXX-X"]);
    expect(JSON.stringify(rows)).not.toContain("5126663-3");
    expect(JSON.stringify(rows)).not.toContain("11222333-9");
  });

  it("calcula el avance % sobre las lecciones publicadas", () => {
    const rows = companyPanelRows(
      inputs({ completedLessons: [{ enrollmentId: E1 }, { enrollmentId: E1 }, { enrollmentId: E2 }] }),
    );
    const byId = new Map(rows.map((r) => [r.enrollmentId, r]));
    expect(byId.get(E1)!.progressPct).toBe(50); // 2 de 4
    expect(byId.get(E2)!.progressPct).toBe(25); // 1 de 4
  });

  it("curso sin lecciones publicadas → 0 % (nunca división por cero)", () => {
    const rows = companyPanelRows(inputs({ totalLessons: 0, completedLessons: [{ enrollmentId: E1 }] }));
    expect(rows.every((r) => r.progressPct === 0)).toBe(true);
  });

  it("cuenta DÍAS distintos y solo de sesiones CERRADAS", () => {
    // 2026-03-10 12:00Z y 2026-03-10 20:00Z caen el MISMO día en Santiago.
    const day1a = Date.parse("2026-03-10T12:00:00Z");
    const day1b = Date.parse("2026-03-10T20:00:00Z");
    const day2 = Date.parse("2026-03-11T12:00:00Z");
    const rows = companyPanelRows(
      inputs({
        sessions: [
          { enrollmentId: E1, status: "cerrada", atMs: day1a },
          { enrollmentId: E1, status: "cerrada", atMs: day1b },
          { enrollmentId: E1, status: "cerrada", atMs: day2 },
          // Ni iniciada ni error son evidencia de asistencia ante SENCE.
          { enrollmentId: E2, status: "iniciada", atMs: day1a },
          { enrollmentId: E2, status: "error", atMs: day2 },
        ],
      }),
    );
    const byId = new Map(rows.map((r) => [r.enrollmentId, r]));
    expect(byId.get(E1)!.attendanceDays).toBe(2);
    expect(byId.get(E2)!.attendanceDays).toBe(0);
  });

  it("nota: solo la publicada llega a la fila; sin nota → null", () => {
    const rows = companyPanelRows(inputs({ grades: new Map([[E1, 6.5]]) }));
    const byId = new Map(rows.map((r) => [r.enrollmentId, r]));
    expect(byId.get(E1)!.grade).toBe(6.5);
    // E2 no está en el mapa (su nota es borrador o no existe): null, no 1.0.
    expect(byId.get(E2)!.grade).toBeNull();
  });

  it("certificado: gana el más reciente (el primero que entrega el llamador)", () => {
    const rows = companyPanelRows(
      inputs({
        certificates: [
          { enrollmentId: E1, folio: "CERT-2026-000009", status: "issued" },
          { enrollmentId: E1, folio: "CERT-2026-000001", status: "revoked" },
        ],
      }),
    );
    const byId = new Map(rows.map((r) => [r.enrollmentId, r]));
    expect(byId.get(E1)!.certificateFolio).toBe("CERT-2026-000009");
    expect(byId.get(E1)!.certificateStatus).toBe("issued");
    expect(byId.get(E2)!.certificateFolio).toBeNull();
  });

  it("certificado REVOCADO sin reemitir: el estado viaja en la fila, no se pierde", () => {
    // El caso que el test de arriba NO cubre: revocar es un UPDATE y el folio
    // SOBREVIVE. Si la fila no llevara el estado, RRHH vería un folio idéntico al
    // de un certificado vigente y lo daría por bueno.
    const rows = companyPanelRows(
      inputs({ certificates: [{ enrollmentId: E1, folio: "CERT-2026-000001", status: "revoked" }] }),
    );
    const row = rows.find((r) => r.enrollmentId === E1)!;
    expect(row.certificateFolio).toBe("CERT-2026-000001");
    expect(row.certificateStatus).toBe("revoked");
  });

  it("el exento se marca como tal (no registra asistencia SENCE, I-14)", () => {
    const rows = companyPanelRows(
      inputs({
        enrollments: [
          { enrollmentId: E1, firstNames: "Ana", lastNames: "Bravo", run: "5126663-3", exento: true },
        ],
      }),
    );
    expect(rows[0]!.exento).toBe(true);
    expect(rows[0]!.attendanceDays).toBe(0);
  });

  it("sin apellidos usa el nombre; sin nada, guión", () => {
    const rows = companyPanelRows(
      inputs({
        enrollments: [
          { enrollmentId: E1, firstNames: "Ana", lastNames: null, run: "5126663-3", exento: false },
          { enrollmentId: E2, firstNames: null, lastNames: null, run: "11222333-9", exento: false },
        ],
      }),
    );
    const byId = new Map(rows.map((r) => [r.enrollmentId, r]));
    expect(byId.get(E1)!.nombre).toBe("Ana");
    expect(byId.get(E2)!.nombre).toBe("—");
  });
});

describe("companyExportRowValues", () => {
  /** Los rótulos reales de `esCL.companyPortal` (el llamador los inyecta). */
  const LABELS: CompanyCertLabels = { issued: "Vigente", revoked: "Revocado" };

  it("serializa la fila con el RUN enmascarado y la nota con 1 decimal", () => {
    const rows = companyPanelRows(
      inputs({
        enrollments: [
          { enrollmentId: E1, firstNames: "María José", lastNames: "Pérez Soto", run: "5126663-3", exento: false },
        ],
        completedLessons: [{ enrollmentId: E1 }, { enrollmentId: E1 }],
        grades: new Map([[E1, 7]]),
        certificates: [{ enrollmentId: E1, folio: "CERT-2026-000001", status: "issued" }],
      }),
    );
    expect(companyExportRowValues(rows[0]!, LABELS)).toEqual([
      "Pérez Soto, María José",
      "51.XXX.XXX-X",
      "50",
      "0",
      "7.0",
      "CERT-2026-000001",
      "Vigente",
    ]);
  });

  it("el estado sale en es-CL, no como el enum crudo de la BD", () => {
    // El Excel lo abre RRHH y sus encabezados están en español: una celda que diga
    // "revoked" bajo "ESTADO CERTIFICADO" no informa a nadie.
    const rows = companyPanelRows(
      inputs({
        enrollments: [{ enrollmentId: E1, firstNames: "Ana", lastNames: "Bravo", run: "5126663-3", exento: false }],
        certificates: [{ enrollmentId: E1, folio: "CERT-2026-000001", status: "revoked" }],
      }),
    );
    const values = companyExportRowValues(rows[0]!, LABELS);
    expect(values[6]).toBe("Revocado");
    expect(values).not.toContain("revoked");
  });

  it("sin nota ni certificado deja celdas vacías (nunca 'null')", () => {
    const rows = companyPanelRows(
      inputs({
        enrollments: [{ enrollmentId: E1, firstNames: "Ana", lastNames: "Bravo", run: "5126663-3", exento: false }],
      }),
    );
    const values = companyExportRowValues(rows[0]!, LABELS);
    expect(values[4]).toBe("");
    expect(values[5]).toBe("");
    expect(values[6]).toBe("");
  });
});
