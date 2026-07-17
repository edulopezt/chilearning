import { describe, expect, it } from "vitest";

import { extractDescriptor } from "./descriptor-extract";

// (a) Formato típico Anexo 4: nombre + horas + 3 módulos + aprendizajes.
// Texto SINTÉTICO (nunca datos reales de un curso real).
const ANEXO_4_TIPICO = `
DESCRIPTOR DEL CURSO

NOMBRE DEL CURSO: Prevención de riesgos en bodega

N° DE HORAS TOTALES: 12

APRENDIZAJES ESPERADOS
- Identificar los riesgos críticos de una bodega de almacenamiento.
- Aplicar el protocolo de uso de EPP según la tarea.
• Reportar incidentes siguiendo el procedimiento interno.

MÓDULO 1: Fundamentos de seguridad en bodega
HORAS: 4
Contenido introductorio del módulo 1.

MÓDULO 2: Uso de equipos de protección personal
HORAS: 4
Contenido del módulo 2.

MÓDULO 3: Reporte y gestión de incidentes
HORAS: 4
Contenido del módulo 3.
`;

// (b) Info "aplanada" tipo tabla (tabs/espacios múltiples). Solo se exige
// tolerancia razonable + NUNCA lanzar, no una extracción perfecta.
const TABLA_APLANADA = `
NOMBRE DEL CURSO\tGestión de inventario básica
HORAS TOTALES\t8

MÓDULO 1\tIntroducción a inventario
HORAS\t4
MÓDULO 2\tControl    de    stock
HORAS\t4
`;

// (c) Texto basura sin ninguna señal reconocible.
const TEXTO_BASURA = `
Reunión de equipo — minuta 14/07
Pendientes: revisar contrato de arriendo, coordinar con Juan el envío.
Nada de esto es un descriptor de curso.
`;

describe("extractDescriptor — fixture (a) Anexo 4 típico", () => {
  const r = extractDescriptor(ANEXO_4_TIPICO);

  it("extrae el nombre del curso", () => {
    expect(r.name).toBe("Prevención de riesgos en bodega");
  });

  it("extrae las horas totales", () => {
    expect(r.totalHours).toBe(12);
  });

  it("extrae los 3 módulos con sus horas", () => {
    expect(r.modules).toHaveLength(3);
    expect(r.modules[0]).toEqual({ title: "Fundamentos de seguridad en bodega", hours: 4 });
    expect(r.modules[1]).toEqual({ title: "Uso de equipos de protección personal", hours: 4 });
    expect(r.modules[2]).toEqual({ title: "Reporte y gestión de incidentes", hours: 4 });
  });

  it("extrae los aprendizajes esperados (bullets con -, • y numerados)", () => {
    expect(r.outcomes).toEqual([
      "Identificar los riesgos críticos de una bodega de almacenamiento.",
      "Aplicar el protocolo de uso de EPP según la tarea.",
      "Reportar incidentes siguiendo el procedimiento interno.",
    ]);
  });

  it("sin warnings: todo se encontró", () => {
    expect(r.warnings).toEqual([]);
  });
});

describe("extractDescriptor — fixture (b) tabla aplanada (tabs/espacios múltiples)", () => {
  it("no lanza y tolera razonablemente el formato", () => {
    expect(() => extractDescriptor(TABLA_APLANADA)).not.toThrow();
    const r = extractDescriptor(TABLA_APLANADA);
    expect(r.name).toContain("Gestión de inventario básica");
    expect(r.totalHours).toBe(8);
    expect(r.modules.length).toBeGreaterThanOrEqual(2);
  });
});

describe("extractDescriptor — fixture (c) texto basura", () => {
  const r = extractDescriptor(TEXTO_BASURA);

  it("no lanza", () => {
    expect(() => extractDescriptor(TEXTO_BASURA)).not.toThrow();
  });

  it("todo null/vacío", () => {
    expect(r.name).toBeNull();
    expect(r.totalHours).toBeNull();
    expect(r.modules).toEqual([]);
    expect(r.outcomes).toEqual([]);
  });

  it("con warnings describiendo qué no se encontró", () => {
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("extractDescriptor — robustez", () => {
  it("texto vacío no lanza", () => {
    expect(() => extractDescriptor("")).not.toThrow();
    const r = extractDescriptor("");
    expect(r.modules).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
