import JSZip from "jszip";

/**
 * Fixture 100% SINTÉTICO (cero contenido real, cero dato de alumnos) de un
 * paquete SCORM 1.2 MÍNIMO Y VÁLIDO: `imsmanifest.xml` (organización → item →
 * resource apuntando a `index.html`) + `index.html` cuyo script busca la API
 * SCORM 1.2 en `window.parent`/`window` y, si la encuentra, hace el ciclo
 * completo (`LMSInitialize` → dos `LMSSetValue` → `LMSCommit` → `LMSFinish`).
 *
 * Lo usan los tests de integración de la ingesta (task 5.1a) y lo reusará el
 * e2e del reproductor (task 5.1b, `scorm-again`).
 */

const MANIFEST_XML = `<?xml version="1.0" standalone="no" ?>
<manifest identifier="com.chilearning.fixture" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-FIXTURE">
    <organization identifier="ORG-FIXTURE">
      <title>Paquete SCORM ficticio (fixture de tests)</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>Lección única</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>
`;

const INDEX_HTML = `<!doctype html>
<html lang="es-CL">
  <head>
    <meta charset="utf-8" />
    <title>Fixture SCORM 1.2 (100% sintético)</title>
  </head>
  <body>
    <p>Contenido de prueba, sin datos reales de ningún alumno ni OTEC.</p>
    <script>
      function findApi(win, tries) {
        if (!win || tries > 10) return null;
        if (win.API) return win.API;
        if (win.parent && win.parent !== win) return findApi(win.parent, tries + 1);
        return null;
      }
      var api = findApi(window.parent, 0) || findApi(window, 0);
      if (api) {
        api.LMSInitialize("");
        api.LMSSetValue("cmi.core.lesson_status", "completed");
        api.LMSSetValue("cmi.core.score.raw", "85");
        api.LMSCommit("");
        api.LMSFinish("");
      }
    </script>
  </body>
</html>
`;

export interface ScormFixtureOptions {
  /** Entries adicionales a inyectar tal cual (para probar rutas inseguras, p.ej. "../evil.js"). */
  readonly extraEntries?: Readonly<Record<string, string>>;
  /** Si es `false`, omite `imsmanifest.xml` (fixture de "no_manifest"). */
  readonly includeManifest?: boolean;
}

/** Construye el .zip del fixture en memoria (Buffer, listo para subir a Storage en los tests). */
export async function buildScormFixtureZip(options: ScormFixtureOptions = {}): Promise<Buffer> {
  const zip = new JSZip();
  if (options.includeManifest ?? true) {
    zip.file("imsmanifest.xml", MANIFEST_XML);
  }
  zip.file("index.html", INDEX_HTML);
  for (const [path, content] of Object.entries(options.extraEntries ?? {})) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

const CENTRAL_DIR_SIGNATURE = Buffer.from([0x50, 0x4b, 0x01, 0x02]); // "PK\x01\x02"

/**
 * Parchea, en el directorio CENTRAL de un .zip YA GENERADO, el campo de 4
 * bytes "uncompressed size" de la entry `entryName` para que declare
 * `lieBytes` en vez de su tamaño real (hallazgo H5-5.1a, 4-ojos HIGH:
 * "zip-bomb guard trusts the attacker-controlled declared uncompressedSize
 * field"). Reproduce el ataque BIT A BIT: jszip (`ZipEntry.readCentralPart`,
 * `lib/zipEntry.js`) lee ese campo tal cual de los bytes del .zip sin
 * corroborarlo contra el contenido comprimido real — el único campo que usa
 * para saber CUÁNTOS bytes leer del payload es `compressedSize` (que este
 * parche NO toca), así que el .zip resultante sigue siendo 100% válido y se
 * abre sin error; solo MIENTE sobre cuánto pesará al descomprimir.
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
 * Paquete SCORM 1.2 válido con una entry (`bomb.bin`) cuyo tamaño
 * descomprimido REAL es `realUncompressedBytes`, pero cuyo directorio
 * central MIENTE que pesa apenas `lieBytes` (por defecto, 10) — el .zip del
 * bypass real del guardia anti zip-bomb (H5-5.1a). Usa contenido altamente
 * repetible (un carácter) para que, con compresión DEFLATE real, el .zip
 * resultante sea pequeño pese al tamaño real declarado como falso.
 */
export async function buildScormZipBombFixture(realUncompressedBytes: number, lieBytes = 10): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("imsmanifest.xml", MANIFEST_XML);
  zip.file("index.html", INDEX_HTML);
  zip.file("bomb.bin", "A".repeat(realUncompressedBytes), { compression: "DEFLATE" });
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return forgeDeclaredUncompressedSize(buffer, "bomb.bin", lieBytes);
}
