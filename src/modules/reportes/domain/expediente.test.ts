import { describe, expect, it } from "vitest";

import { completeness, expedienteChecklist, manifestRows, parseDocumentInput, validateExpedienteFile } from "./expediente";

describe("expedienteChecklist + completeness (línea 3)", () => {
  it("marca presentes/faltantes y la completitud", () => {
    const docs = [
      { docType: "orden_compra_otic" as const, isDefinitive: true },
      { docType: "comunicacion" as const, isDefinitive: false },
      { docType: "nomina" as const, isDefinitive: false },
    ];
    const cl = expedienteChecklist(docs, 3);
    expect(cl.find((c) => c.docType === "orden_compra_otic")?.hasDefinitive).toBe(true);
    expect(cl.find((c) => c.docType === "dj")?.present).toBe(false);
    const c = completeness(docs, 3);
    expect(c.total).toBe(5);
    expect(c.done).toBe(3);
    expect(c.complete).toBe(false);
  });

  it("completo cuando están todos los requeridos", () => {
    const docs = (["orden_compra_otic", "comunicacion", "nomina", "dj", "certificado"] as const).map((t) => ({ docType: t, isDefinitive: false }));
    expect(completeness(docs, 3).complete).toBe(true);
  });
});

describe("parse + validación de archivo", () => {
  it("parsea un documento válido y rechaza tipo inválido", () => {
    expect(parseDocumentInput({ docType: "dj", title: "DJ OTEC" }).ok).toBe(true);
    expect(parseDocumentInput({ docType: "x", title: "y" }).ok).toBe(false);
  });
  it("valida MIME y tamaño", () => {
    expect(validateExpedienteFile({ size: 1000, type: "application/pdf" }).ok).toBe(true);
    expect(validateExpedienteFile({ size: 1000, type: "text/plain" }).ok).toBe(false);
    expect(validateExpedienteFile({ size: 99_000_000, type: "application/pdf" }).ok).toBe(false);
  });
});

describe("manifestRows", () => {
  it("arma una fila por documento con etiqueta legible", () => {
    const rows = manifestRows([{ docType: "dj", title: "DJ", status: "vigente", isDefinitive: true, documentDate: "2026-07-01", fileName: "dj.pdf" }]);
    expect(rows[0]![0]).toBe("Declaración Jurada");
    expect(rows[0]![3]).toBe("definitivo");
  });
});
