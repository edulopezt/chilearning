import { describe, expect, it } from "vitest";

import {
  AVISO_INACTIVO_V1,
  buildAvisoInactivoParams,
  buildCertificadoDisponibleParams,
  buildRecordatorioAsistenciaParams,
  CERTIFICADO_DISPONIBLE_V1,
  RECORDATORIO_ASISTENCIA_V1,
  sanitizeFirstNameForWhatsApp,
} from "./whatsapp-templates";

describe("sanitizeFirstNameForWhatsApp (minimización RNF-10)", () => {
  it("toma solo el primer nombre, sin apellido", () => {
    expect(sanitizeFirstNameForWhatsApp("Ana Pérez Soto")).toBe("Ana");
  });
  it("un RUN colado (solo dígitos y puntuación) cae al fallback", () => {
    expect(sanitizeFirstNameForWhatsApp("12.345.678-9")).toBe("Alumno/a");
  });
  it("quita dígitos/puntuación de un correo colado (queda solo la parte con letras)", () => {
    // Limitación conocida (mismo criterio que tutor-ia/domain/prompt.ts): se
    // eliminan dígitos y símbolos, pero las LETRAS de un correo mal puesto en
    // este campo sobreviven — no es un blanqueo total, es el mismo filtro que
    // ya usa el resto del sistema para "primer nombre".
    expect(sanitizeFirstNameForWhatsApp("ana@otec.cl")).toBe("anaoteccl");
  });
  it("cae al fallback si queda vacío", () => {
    expect(sanitizeFirstNameForWhatsApp("")).toBe("Alumno/a");
    expect(sanitizeFirstNameForWhatsApp("   ")).toBe("Alumno/a");
  });
  it("es idempotente (aplicarlo dos veces no cambia el resultado)", () => {
    const once = sanitizeFirstNameForWhatsApp("María José López");
    expect(sanitizeFirstNameForWhatsApp(once)).toBe(once);
  });
});

describe("plantillas: nombre versionado + copy aprobado documentativo", () => {
  it("cada plantilla tiene sufijo _v1 y copy es-CL", () => {
    for (const t of [RECORDATORIO_ASISTENCIA_V1, AVISO_INACTIVO_V1, CERTIFICADO_DISPONIBLE_V1]) {
      expect(t.name).toMatch(/_v1$/);
      expect(t.languageCode).toBe("es");
      expect(t.approvedBodyEs).toContain("{{1}}");
      expect(t.approvedBodyEs).toContain("{{2}}");
    }
  });
});

describe("builders de parámetros (arreglo ordenado [firstName, courseName])", () => {
  it("recordatorio de asistencia", () => {
    expect(buildRecordatorioAsistenciaParams("Ana Pérez", "Prevención de Riesgos")).toEqual([
      "Ana",
      "Prevención de Riesgos",
    ]);
  });
  it("aviso a inactivos", () => {
    expect(buildAvisoInactivoParams("Beto Soto", "Excel Intermedio")).toEqual(["Beto", "Excel Intermedio"]);
  });
  it("certificado disponible (sin llamador aún, pero exportada)", () => {
    expect(buildCertificadoDisponibleParams("Cata Vera", "Higiene y Seguridad")).toEqual([
      "Cata",
      "Higiene y Seguridad",
    ]);
  });
});
