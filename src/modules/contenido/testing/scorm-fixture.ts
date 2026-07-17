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
