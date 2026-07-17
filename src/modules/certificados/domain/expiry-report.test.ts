import { describe, expect, it } from "vitest";

import {
  expirationExportRowValues,
  formatExpiryDate,
  pickRecertifyAction,
  sortByUrgency,
  EXPIRATION_EXPORT_HEADERS,
  type ExpirationRow,
} from "@/modules/certificados/domain/expiry-report";
import { sanitizeXlsxCell } from "@/modules/portal-empresa/domain/company";

const LABELS = { particular: "Particular", expired: "VENCIDO" };

function row(over: Partial<ExpirationRow> = {}): ExpirationRow {
  return {
    certificateId: "c1", folio: "CERT-2026-000001", studentName: "Silva Rojas, Ana",
    runMasked: "51.XXX.XXX-X", courseName: "Trabajo en altura", codigoAccion: "ACC-1",
    courseId: "cur1", actionId: "act1", companyId: "co1", razonSocial: "Constructora Demo SpA",
    expiresAt: "2026-10-15T00:00:00.000Z", daysLeft: 90, recertifyActionId: "act2", ...over,
  };
}

describe("formatExpiryDate", () => {
  it("formatea dd-mm-aaaa (es-CL) en UTC", () => {
    expect(formatExpiryDate("2026-10-05T00:00:00.000Z")).toBe("05-10-2026");
    expect(formatExpiryDate("2026-01-31T23:59:00.000Z")).toBe("31-01-2026");
  });
  it("fecha inválida ⇒ cadena vacía (no 'Invalid Date' en el Excel)", () => {
    expect(formatExpiryDate("basura")).toBe("");
  });
});

describe("sortByUrgency", () => {
  it("lo ya vencido y lo más próximo primero", () => {
    const rows = [
      row({ certificateId: "c60", expiresAt: "2026-09-15T00:00:00.000Z" }),
      row({ certificateId: "vencido", expiresAt: "2026-07-05T00:00:00.000Z" }),
      row({ certificateId: "c30", expiresAt: "2026-08-16T00:00:00.000Z" }),
    ];
    expect(sortByUrgency(rows).map((r) => r.certificateId)).toEqual(["vencido", "c30", "c60"]);
  });
  it("no muta la entrada", () => {
    const rows = [row({ certificateId: "b", expiresAt: "2026-09-15T00:00:00.000Z" }), row({ certificateId: "a", expiresAt: "2026-07-05T00:00:00.000Z" })];
    sortByUrgency(rows);
    expect(rows.map((r) => r.certificateId)).toEqual(["b", "a"]);
  });
});

describe("pickRecertifyAction", () => {
  const mk = (id: string, startsOn: string | null, createdAt = "2026-01-01T00:00:00.000Z") => ({ id, startsOn, createdAt });

  it("★ nunca devuelve la acción que YA certificó (reinscribir ahí no recertifica)", () => {
    expect(pickRecertifyAction("act1", [mk("act1", "2025-03-01")])).toBeNull();
  });

  it("sin otra acción del curso ⇒ null (la UI manda a crearla)", () => {
    expect(pickRecertifyAction("act1", [])).toBeNull();
  });

  it("elige la de starts_on más reciente", () => {
    expect(pickRecertifyAction("act1", [
      mk("act1", "2025-03-01"), mk("act2", "2026-09-01"), mk("act3", "2026-02-01"),
    ])).toBe("act2");
  });

  it("★ la acción SIN fecha gana: es la recién clonada para la nueva versión (D-025)", () => {
    // Una acción nace en borrador y sin fechas; filtrarla por "fecha futura"
    // dejaría fuera justo la candidata típica de recertificación.
    expect(pickRecertifyAction("act1", [
      mk("act1", "2025-03-01"), mk("act2", "2026-09-01"), mk("draft", null),
    ])).toBe("draft");
  });

  it("empate de fechas ⇒ desempata por created_at (orden total, determinista)", () => {
    expect(pickRecertifyAction("act1", [
      mk("viejo", "2026-09-01", "2026-01-01T00:00:00.000Z"),
      mk("nuevo", "2026-09-01", "2026-06-01T00:00:00.000Z"),
    ])).toBe("nuevo");
  });
});

describe("expirationExportRowValues", () => {
  it("respeta el orden de los encabezados", () => {
    const values = expirationExportRowValues(row(), LABELS);
    expect(values).toHaveLength(EXPIRATION_EXPORT_HEADERS.length);
    expect(values).toEqual([
      "Silva Rojas, Ana", "51.XXX.XXX-X", "Trabajo en altura", "ACC-1",
      "CERT-2026-000001", "15-10-2026", "90", "Constructora Demo SpA",
    ]);
  });

  it("★ lo vencido se rotula, no sale como número negativo", () => {
    expect(expirationExportRowValues(row({ daysLeft: -12 }), LABELS)[6]).toBe("VENCIDO");
  });

  it("sin empresa ⇒ 'Particular' (la celda no queda vacía)", () => {
    expect(expirationExportRowValues(row({ razonSocial: null, companyId: null }), LABELS)[7]).toBe("Particular");
  });

  it("★ un nombre hostil se neutraliza al sanear la celda (D-021)", () => {
    // El apellido es lo que abre la celda: ahí el `=` cae en la posición 0, la
    // única que Excel evalúa.
    const values = expirationExportRowValues(row({ studentName: "=cmd|' /C calc'!A0, Ana" }), LABELS);
    expect(sanitizeXlsxCell(values[0]!)).toBe("'=cmd|' /C calc'!A0, Ana");
  });
});
