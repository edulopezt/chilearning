import { describe, expect, it } from "vitest";

import { stripPIIForDraft } from "./pii-strip";

describe("stripPIIForDraft — RUN chileno (task 5.9, HU-9.5)", () => {
  it("con puntos y guion", () => {
    expect(stripPIIForDraft("mi RUN es 12.345.678-9, saludos")).toBe(
      "mi RUN es [dato omitido], saludos",
    );
  });
  it("sin puntos, con guion (7 dígitos de cuerpo)", () => {
    expect(stripPIIForDraft("run: 5126663-3")).toBe("run: [dato omitido]");
  });
  it("con espacios en vez de puntos", () => {
    expect(stripPIIForDraft("12 345 678 9 es mi run")).toBe("[dato omitido] es mi run");
  });
  it("dígito verificador k minúscula y K mayúscula", () => {
    expect(stripPIIForDraft("12.345.678-k")).toBe("[dato omitido]");
    expect(stripPIIForDraft("12.345.678-K")).toBe("[dato omitido]");
  });
  it("sin separador antes del verificador", () => {
    expect(stripPIIForDraft("12.345.6789")).toBe("[dato omitido]");
  });
});

describe("stripPIIForDraft — correos", () => {
  it("correo simple", () => {
    expect(stripPIIForDraft("mi correo es juan.perez@otec.cl, respondan ahi")).toBe(
      "mi correo es [dato omitido], respondan ahi",
    );
  });
  it("correo con subdominio y alias +", () => {
    expect(stripPIIForDraft("contacto: ana+alumna@campus.otec.edu.cl")).toBe(
      "contacto: [dato omitido]",
    );
  });
});

describe("stripPIIForDraft — telefono chileno (movil)", () => {
  it("con +56 y espacios", () => {
    expect(stripPIIForDraft("llamame al +56 9 1234 5678 porfa")).toBe(
      "llamame al [dato omitido] porfa",
    );
  });
  it("con 56 y guiones, sin +", () => {
    expect(stripPIIForDraft("mi numero: 56-9-1234-5678")).toBe("mi numero: [dato omitido]");
  });
  it("sin codigo de pais, sin separadores", () => {
    expect(stripPIIForDraft("whatsapp 912345678")).toBe("whatsapp [dato omitido]");
  });
});

describe("stripPIIForDraft — texto limpio no se toca", () => {
  it("un texto sin RUN/correo/telefono queda identico", () => {
    const clean =
      "El curso dura 40 horas, tiene 5 módulos y la lección 3 explica el uso correcto del EPP.";
    expect(stripPIIForDraft(clean)).toBe(clean);
  });
});

describe("stripPIIForDraft — adversarial: RUN/telefono pegados sin espacio (revisión 5.9, bug real corregido)", () => {
  it("RUN pegado a la palabra anterior y siguiente, sin espacio en ningún lado", () => {
    expect(stripPIIForDraft("midudaes:soyrut12345678-9tengounaduda")).toBe(
      "midudaes:soyrut[dato omitido]tengounaduda",
    );
  });
  it("RUN pegado solo a la palabra anterior ('rut12345678-9 saludos')", () => {
    expect(stripPIIForDraft("consulta sobre modulo3 mi rut12345678-9 saludos")).toBe(
      "consulta sobre modulo3 mi rut[dato omitido] saludos",
    );
  });
  it("RUN pegado a la palabra siguiente, sin espacio antes del verificador ('12345678-9gracias')", () => {
    expect(stripPIIForDraft("mi rut es 12345678-9gracias")).toBe("mi rut es [dato omitido]gracias");
  });
  it("telefono pegado a la palabra siguiente, sin ningún separador ('cel912345678sinespacio')", () => {
    expect(stripPIIForDraft("cel912345678sinespacio")).toBe("cel[dato omitido]sinespacio");
  });
});

describe("stripPIIForDraft — no redacta números que NO son un RUN/teléfono (falso positivo corregido)", () => {
  it("una fecha AAAAMMDD de 8 dígitos sin separadores no se toca", () => {
    expect(stripPIIForDraft("el numero de folio es 20260713 gracias")).toBe(
      "el numero de folio es 20260713 gracias",
    );
  });
  it("otra fecha de 8 dígitos mencionada por el alumno no se toca", () => {
    expect(stripPIIForDraft("la asistencia del dia 13072026 no aparece")).toBe(
      "la asistencia del dia 13072026 no aparece",
    );
  });
  it("un teléfono fijo chileno (8 dígitos, sin el 9 móvil, sin separadores) no se toca", () => {
    expect(stripPIIForDraft("tel fijo 22345678 (sin el 9 movil)")).toBe(
      "tel fijo 22345678 (sin el 9 movil)",
    );
  });
  it("un entero de 8 dígitos genérico sin ningún separador no se toca", () => {
    expect(stripPIIForDraft("mi matricula es 12345678, cuando parte el modulo 2?")).toBe(
      "mi matricula es 12345678, cuando parte el modulo 2?",
    );
  });
});

describe("stripPIIForDraft — mezcla de varios patrones en un mismo texto", () => {
  it("redacta los 3 tipos a la vez, dejando el resto del texto intacto", () => {
    const poisoned =
      "Hola, soy Juan Perez, mi run es 12.345.678-9, mi correo juan.perez@otec.cl " +
      "y mi telefono +56 9 1234 5678. Tengo una duda sobre la leccion 2.";
    const result = stripPIIForDraft(poisoned);
    expect(result).not.toMatch(/\d{1,2}[.\s]?\d{3}[.\s]?\d{3}[-\s]?[0-9kK]/);
    expect(result).not.toContain("@");
    expect(result).toContain("Tengo una duda sobre la leccion 2.");
    expect(result.match(/\[dato omitido\]/g)?.length).toBe(3);
  });
});
