import JSZip from "jszip";

/**
 * Fixture 100% SINTÉTICO (cero contenido real de ningún OTEC/curso) de un
 * .docx MÍNIMO Y VÁLIDO. Un .docx es un .zip; mammoth solo exige que exista
 * `word/document.xml` (cae a ese fallback si faltan `_rels/.rels` o
 * `[Content_Types].xml` — ver `docx-reader.js#findPartPaths`), así que ese es
 * el único archivo que este fixture necesita.
 *
 * Lo usa `wizard-service.integration.test.ts` para probar el flujo
 * "desde descriptor SENCE" de punta a punta sin depender de un archivo externo.
 */

const NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function paragraph(text: string): string {
  // Escapa lo mínimo indispensable para XML bien formado.
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
}

/** Construye el .docx en memoria (Buffer) a partir de las líneas de texto dadas (una por párrafo). */
export async function buildDescriptorFixtureDocx(lines: readonly string[]): Promise<Buffer> {
  const body = lines.map(paragraph).join("\n");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${NS}"><w:body>${body}</w:body></w:document>`;

  const zip = new JSZip();
  zip.file("word/document.xml", documentXml);
  return zip.generateAsync({ type: "nodebuffer" });
}

/** Líneas de un descriptor SENCE SINTÉTICO típico (Anexo 4), para los tests de extracción. */
export const DESCRIPTOR_FIXTURE_LINES: readonly string[] = [
  "DESCRIPTOR DEL CURSO",
  "",
  "NOMBRE DEL CURSO: Manejo seguro de extintores",
  "",
  "HORAS TOTALES: 8",
  "",
  "APRENDIZAJES ESPERADOS",
  "- Reconocer los tipos de extintores y su uso según la clase de fuego.",
  "- Aplicar el protocolo de uso en una emergencia simulada.",
  "",
  "MÓDULO 1: Introducción a los extintores",
  "HORAS: 4",
  "",
  "MÓDULO 2: Uso práctico en emergencia",
  "HORAS: 4",
];
