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

/**
 * Fixture "zip-bomb honesta" (declara HONESTAMENTE su tamaño descomprimido):
 * un único entry `word/document.xml` con MUCHOS bytes REPETIDOS. Con
 * compresión DEFLATE real, el .docx resultante pesa apenas unos KB (pasa de
 * sobra el límite de 10 MB comprimidos), pero su directorio central declara
 * honestamente `uncompressedBytes` — sin necesidad de "mentir" el campo (a
 * diferencia de `buildDescriptorForgedSizeFixture` más abajo) — sirve para
 * ejercitar el pre-chequeo BARATO (`exceedsDescriptorUncompressedBudget`).
 * ⚠ Esto NO reproduce el bypass real (ver el aviso de `domain/descriptor-zip.ts`):
 * para eso usa `buildDescriptorForgedSizeFixture`.
 */
export async function buildDescriptorZipBombFixture(uncompressedBytes: number): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", "A".repeat(uncompressedBytes), { compression: "DEFLATE" });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

const CENTRAL_DIR_SIGNATURE = Buffer.from([0x50, 0x4b, 0x01, 0x02]); // "PK\x01\x02"

/**
 * Parchea, en el directorio CENTRAL de un .zip YA GENERADO, el campo de 4
 * bytes "uncompressed size" de la entry `entryName` para que declare
 * `lieBytes` en vez de su tamaño real (mismo patrón EXACTO que
 * `contenido/testing/scorm-fixture.ts::forgeDeclaredUncompressedSize` — se
 * duplica acá, no se importa, para no acoplar el módulo `academico` a
 * `contenido` por un detalle privado de implementación de una librería de
 * terceros). Reproduce el ataque BIT A BIT: jszip lee ese campo tal cual de
 * los bytes del .zip sin corroborarlo contra el contenido comprimido real —
 * el único campo que usa para saber CUÁNTOS bytes leer del payload es
 * `compressedSize` (que este parche NO toca), así que el .zip resultante
 * sigue siendo 100% válido y se abre sin error; solo MIENTE cuánto pesará al
 * descomprimir.
 */
export function forgeDeclaredUncompressedSize(zipBuffer: Buffer, entryName: string, lieBytes: number): Buffer {
  const buf = Buffer.from(zipBuffer); // copia: nunca mutar el buffer del caller
  const nameBytes = Buffer.from(entryName, "utf8");

  let searchFrom = 0;
  for (;;) {
    const recordStart = buf.indexOf(CENTRAL_DIR_SIGNATURE, searchFrom);
    if (recordStart === -1) {
      throw new Error(`forgeDeclaredUncompressedSize: entry "${entryName}" no encontrada en el directorio central`);
    }
    const fileNameLength = buf.readUInt16LE(recordStart + 28);
    const nameStart = recordStart + 46;
    const candidateName = buf.subarray(nameStart, nameStart + fileNameLength);
    if (fileNameLength === nameBytes.length && candidateName.equals(nameBytes)) {
      buf.writeUInt32LE(lieBytes >>> 0, recordStart + 24); // offset 24 = "uncompressed size" (4 bytes)
      return buf;
    }
    searchFrom = recordStart + 4;
  }
}

/**
 * Descriptor .docx con una entry (`bomb.bin`) cuyo tamaño descomprimido REAL
 * es `realUncompressedBytes`, pero cuyo directorio central MIENTE que pesa
 * apenas `lieBytes` (por defecto, 10) — el bypass REAL del guardia anti
 * zip-bomb: el pre-chequeo por tamaño DECLARADO pasa de largo (declara ser
 * chico), así que solo el streaming de bytes REALES en
 * `descriptor-extract.ts::readEntryBytes` puede cazarlo. Además de
 * `bomb.bin` incluye un `word/document.xml` mínimo válido, porque
 * `runDescriptorExtract` mide TODAS las entries del .zip bajo el mismo
 * presupuesto compartido (no solo `document.xml`).
 */
export async function buildDescriptorForgedSizeFixture(realUncompressedBytes: number, lieBytes = 10): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", minimalDocumentXml());
  zip.file("bomb.bin", "A".repeat(realUncompressedBytes), { compression: "DEFLATE" });
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return forgeDeclaredUncompressedSize(buffer, "bomb.bin", lieBytes);
}

/** Contenido mínimo válido de `word/document.xml` (un único párrafo), reusado por los fixtures de arriba. */
function minimalDocumentXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${NS}"><w:body>${paragraph("x")}</w:body></w:document>`;
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
