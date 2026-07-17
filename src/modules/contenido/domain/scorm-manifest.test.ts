import { describe, expect, it } from "vitest";

import { parseScormManifest } from "./scorm-manifest";

/** Fixtures XML SINTÉTICOS inline (cero contenido real) — task 5.1a, HU-4.2. */

const MANIFEST_12 = `<?xml version="1.0" standalone="no" ?>
<manifest identifier="com.fixture.a" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Curso 1.2</title>
      <item identifier="ITEM-1" identifierref="RES-1"><title>Lección 1</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`;

const MANIFEST_2004 = `<?xml version="1.0" standalone="no" ?>
<manifest identifier="com.fixture.b" version="1.3"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3">
  <metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata>
  <organizations default="ORG-2">
    <organization identifier="ORG-2">
      <title>Curso 2004</title>
      <item identifier="ITEM-1" identifierref="RES-1"><title>Lección 1</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormType="sco" href="scorms/index.html">
      <file href="scorms/index.html"/>
    </resource>
  </resources>
</manifest>`;

const MANIFEST_NO_RESOURCES = `<?xml version="1.0" standalone="no" ?>
<manifest identifier="com.fixture.c" version="1.2">
  <metadata><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Sin resources</title>
      <item identifier="ITEM-1" identifierref="RES-1"><title>Lección 1</title></item>
    </organization>
  </organizations>
</manifest>`;

const MANIFEST_NO_HREF = `<?xml version="1.0" standalone="no" ?>
<manifest identifier="com.fixture.d" version="1.2">
  <metadata><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Sin href</title>
      <item identifier="ITEM-1" identifierref="RES-1"><title>Lección 1</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent"><file/></resource>
  </resources>
</manifest>`;

const MANIFEST_MALFORMED = `<?xml version="1.0" ?><manifest><organizations><organization>`;

// Sin <schemaversion> en absoluto, pero con el namespace de SCORM 2004 (CAM 1.3, adlcp_v1p3).
const MANIFEST_2004_NO_SCHEMAVERSION = `<?xml version="1.0" standalone="no" ?>
<manifest identifier="com.fixture.e" version="1.3"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3">
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Sin schemaversion</title>
      <item identifier="ITEM-1" identifierref="RES-1"><title>Lección 1</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormType="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`;

describe("parseScormManifest (task 5.1a, HU-4.2)", () => {
  it("manifiesto 1.2 mínimo válido", () => {
    const r = parseScormManifest(MANIFEST_12);
    expect(r).toEqual({ ok: true, version: "1.2", entryHref: "index.html", title: "Curso 1.2", resourceCount: 1 });
  });

  it("manifiesto 2004 válido (resuelve href anidado)", () => {
    const r = parseScormManifest(MANIFEST_2004);
    expect(r).toEqual({
      ok: true,
      version: "2004",
      entryHref: "scorms/index.html",
      title: "Curso 2004",
      resourceCount: 1,
    });
  });

  it("sin <resources> → no_entry", () => {
    expect(parseScormManifest(MANIFEST_NO_RESOURCES)).toEqual({ ok: false, error: "no_entry" });
  });

  it("resource sin href → no_entry", () => {
    expect(parseScormManifest(MANIFEST_NO_HREF)).toEqual({ ok: false, error: "no_entry" });
  });

  it("XML malformado (tags sin cerrar) → invalid_manifest", () => {
    expect(parseScormManifest(MANIFEST_MALFORMED)).toEqual({ ok: false, error: "invalid_manifest" });
  });

  it("XML vacío → no_manifest", () => {
    expect(parseScormManifest("")).toEqual({ ok: false, error: "no_manifest" });
    expect(parseScormManifest("   ")).toEqual({ ok: false, error: "no_manifest" });
  });

  it("sin <schemaversion> pero con namespace 2004 (adlcp_v1p3) → detecta 2004", () => {
    const r = parseScormManifest(MANIFEST_2004_NO_SCHEMAVERSION);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.version).toBe("2004");
  });
});
