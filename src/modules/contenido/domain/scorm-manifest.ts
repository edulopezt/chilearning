import { XMLParser } from "fast-xml-parser";

/**
 * Parseo puro (sin IO) de `imsmanifest.xml` (task 5.1a, HU-4.2, ADR-006). Lo
 * invoca el worker (`scorm-extract.ts`) tras extraer el .zip subido — SIN
 * `server-only`, este archivo no toca IO ni la BD.
 *
 * Detecta la versión (1.2/2004), el punto de entrada real (organización por
 * defecto → primer `<item identifierref>` → el `<resource href>` que le
 * corresponde, resolviendo `xml:base` si existe) y un resumen mínimo — NUNCA
 * el XML completo pasa de aquí hacia la fila `scorm_packages.manifest`.
 */

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  trimValues: true,
} as const;

export type ScormVersion = "1.2" | "2004";

export type ScormManifestResult =
  | { ok: true; version: ScormVersion; entryHref: string; title: string; resourceCount: number }
  | { ok: false; error: "no_manifest" | "invalid_manifest" | "no_entry" };

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Versión SCORM: `<schemaversion>` manda; si falta o es ambiguo, se busca el
 * namespace `adlcp_v1p3` (SCORM 2004 / CAM 1.3) en el manifiesto completo. Sin
 * ninguna señal, se asume 1.2 (el paquete más simple/antiguo y más tolerante).
 */
function detectVersion(manifest: Record<string, unknown>): ScormVersion {
  const metadata = asRecord(manifest.metadata);
  const rawSchemaVersion = metadata?.schemaversion;
  const schemaVersion = typeof rawSchemaVersion === "string" ? rawSchemaVersion : String(rawSchemaVersion ?? "");
  if (schemaVersion.includes("1.2")) return "1.2";
  if (schemaVersion.includes("2004")) return "2004";
  const raw = JSON.stringify(manifest);
  if (/adlcp_v1p3|CAM\s*1\.3/i.test(raw)) return "2004";
  return "1.2";
}

/** Primer `<item identifierref="…">` en orden de documento (recorre clusters anidados sin ref). */
function findFirstItemRef(items: readonly unknown[]): string | null {
  for (const raw of items) {
    const item = asRecord(raw);
    if (!item) continue;
    const ref = item["@_identifierref"];
    if (typeof ref === "string" && ref.length > 0) return ref;
    const found = findFirstItemRef(toArray(item.item));
    if (found) return found;
  }
  return null;
}

/** Resuelve `href` contra `xml:base` (del resource o, si no, del contenedor `<resources>`). */
function joinBase(base: string, href: string): string {
  if (!base) return href;
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(href)) return href; // href ya absoluta
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}${href}`;
}

export function parseScormManifest(xml: string): ScormManifestResult {
  const trimmed = typeof xml === "string" ? xml.trim() : "";
  if (trimmed === "") return { ok: false, error: "no_manifest" };

  let parsed: unknown;
  try {
    parsed = new XMLParser(parserOptions).parse(trimmed);
  } catch {
    return { ok: false, error: "invalid_manifest" };
  }

  const root = asRecord(parsed);
  const manifest = root ? asRecord(root.manifest) : null;
  if (!manifest) return { ok: false, error: "no_manifest" };

  const version = detectVersion(manifest);

  const organizations = asRecord(manifest.organizations);
  const orgList = organizations ? toArray(organizations.organization) : [];
  if (orgList.length === 0) return { ok: false, error: "invalid_manifest" };

  const defaultId = typeof organizations?.["@_default"] === "string" ? (organizations["@_default"] as string) : undefined;
  const org =
    (defaultId ? orgList.find((o) => asRecord(o)?.["@_identifier"] === defaultId) : undefined) ?? orgList[0];
  const orgRecord = asRecord(org);
  if (!orgRecord) return { ok: false, error: "invalid_manifest" };

  const title = typeof orgRecord.title === "string" ? orgRecord.title.trim() : String(orgRecord.title ?? "").trim();

  const itemRef = findFirstItemRef(toArray(orgRecord.item));
  if (!itemRef) return { ok: false, error: "no_entry" };

  const resources = asRecord(manifest.resources);
  const resourceList = resources ? toArray(resources.resource) : [];
  if (resourceList.length === 0) return { ok: false, error: "no_entry" };

  const resource = resourceList.map(asRecord).find((r) => r?.["@_identifier"] === itemRef);
  if (!resource) return { ok: false, error: "no_entry" };

  const href = resource["@_href"];
  if (typeof href !== "string" || href.length === 0) return { ok: false, error: "no_entry" };

  const base =
    (typeof resource["@_xml:base"] === "string" ? (resource["@_xml:base"] as string) : undefined) ??
    (typeof resources?.["@_xml:base"] === "string" ? (resources["@_xml:base"] as string) : undefined) ??
    "";
  const entryHref = joinBase(base, href);

  return { ok: true, version, entryHref, title, resourceCount: resourceList.length };
}
