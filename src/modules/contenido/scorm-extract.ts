// ⚠ SIN `import "server-only"`: lo ejecuta el proceso worker (jobs
// `scorm-extract`/`scorm-sweep`), fuera de Next. Imports RELATIVOS (el bundle
// de esbuild no resuelve el alias `@/`) y NADA que arrastre `server-only`
// (tenant-guard, audit y reportes/zip.ts lo tienen — por eso NO se usan aquí).
// Mismo patrón que `comunicacion/reminders.ts` / `certificados/expiry-alerts.ts`.
import type { SupabaseClient } from "@supabase/supabase-js";
import JSZip from "jszip";

import { parseScormManifest } from "./domain/scorm-manifest";
import { contentTypeFor, exceedsUncompressedBudget, sanitizeScormPath, validateZipEntries } from "./domain/scorm-zip";

/**
 * Extracción y validación de paquetes SCORM (task 5.1a, HU-4.2, ADR-006): la
 * CA de HU-4.2 exige que el paquete se valide AL SUBIR pero en el WORKER, no
 * en el request web. `runScormExtract` hace todo el trabajo pesado (descarga
 * el .zip, valida entries, ubica y parsea `imsmanifest.xml`, sube cada asset
 * extraído) y deja la fila en `ready` o `error` con un `error_code` acotado.
 *
 * `runScormSweep` es la red de seguridad: recoge paquetes `uploaded` que
 * nunca se encolaron (Redis caído en el momento de la subida) y `processing`
 * que quedaron huérfanos (worker murió a medio proceso).
 */

const BUCKET = "scorm";
const SWEEP_UPLOADED_STALE_MS = 2 * 60 * 1000;
const SWEEP_PROCESSING_STALE_MS = 30 * 60 * 1000;

export type ScormErrorCode = "no_manifest" | "invalid_manifest" | "entry_missing" | "unsafe_path" | "too_large" | "storage_error";

export interface ScormExtractDeps {
  readonly packageId: string;
  readonly tenantId: string;
  readonly now: number;
}

export type ScormExtractResult = { ok: true } | { ok: false; errorCode: ScormErrorCode | "not_found" };

async function markError(db: SupabaseClient, packageId: string, tenantId: string, errorCode: ScormErrorCode): Promise<void> {
  await db
    .from("scorm_packages")
    .update({ status: "error", error_code: errorCode })
    .eq("id", packageId)
    .eq("tenant_id", tenantId);
}

/**
 * Campo INTERNO de jszip (no forma parte de su `.d.ts` público): lo llena al
 * PARSEAR el header local de cada entry, ANTES de descomprimir su contenido —
 * es lo que permite el guardia anti zip-bomb sin inflar todo en memoria.
 */
function declaredUncompressedSize(entry: JSZip.JSZipObject): number {
  const raw = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
  return typeof raw?.uncompressedSize === "number" ? raw.uncompressedSize : 0;
}

/** Nombre CRUDO de una entry: jszip ya sanea `.name` (neutraliza ".."); `unsafeOriginalName` trae el original si difiere. */
function entryRawName(entry: JSZip.JSZipObject): string {
  return entry.unsafeOriginalName ?? entry.name;
}

/** Ubica `imsmanifest.xml`: en la raíz, o bajo el ÚNICO directorio raíz común a todas las entries. */
function findManifestEntry(entries: readonly JSZip.JSZipObject[]): JSZip.JSZipObject | undefined {
  const atRoot = entries.find((e) => e.name === "imsmanifest.xml");
  if (atRoot) return atRoot;
  const firstSegments = new Set(entries.map((e) => (e.name.includes("/") ? e.name.split("/")[0] : null)));
  if (firstSegments.size === 1) {
    const [prefix] = [...firstSegments];
    if (prefix) return entries.find((e) => e.name === `${prefix}/imsmanifest.xml`);
  }
  return undefined;
}

async function cleanupUploaded(db: SupabaseClient, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await db.storage.from(BUCKET).remove([...paths]);
  } catch {
    // Best-effort: un fallo al limpiar no debe enmascarar el error real.
  }
}

export async function runScormExtract(db: SupabaseClient, deps: ScormExtractDeps): Promise<ScormExtractResult> {
  const { packageId, tenantId } = deps;

  const { data: pkg } = await db
    .from("scorm_packages")
    .select("id, zip_path")
    .eq("id", packageId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!pkg) return { ok: false, errorCode: "not_found" };

  await db.from("scorm_packages").update({ status: "processing" }).eq("id", packageId).eq("tenant_id", tenantId);

  const dl = await db.storage.from(BUCKET).download(pkg.zip_path as string);
  if (dl.error || !dl.data) {
    await markError(db, packageId, tenantId, "storage_error");
    return { ok: false, errorCode: "storage_error" };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await dl.data.arrayBuffer());
  } catch {
    await markError(db, packageId, tenantId, "invalid_manifest");
    return { ok: false, errorCode: "invalid_manifest" };
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir);

  const pathsCheck = validateZipEntries(entries.map(entryRawName));
  if (!pathsCheck.ok) {
    // `unsafe_path`/`too_many_files`: NADA se sube a Storage en este camino.
    // `too_many_files` no tiene código propio en `scorm_packages.error_code`
    // (CHECK acotado): se mapea a `too_large`, la misma familia de guardia por
    // exceso de recursos que el límite de bytes descomprimidos.
    const errorCode: ScormErrorCode = pathsCheck.error === "too_many_files" ? "too_large" : "unsafe_path";
    await markError(db, packageId, tenantId, errorCode);
    return { ok: false, errorCode };
  }

  const totalUncompressed = entries.reduce((sum, e) => sum + declaredUncompressedSize(e), 0);
  if (exceedsUncompressedBudget(totalUncompressed)) {
    await markError(db, packageId, tenantId, "too_large");
    return { ok: false, errorCode: "too_large" };
  }

  const manifestEntry = findManifestEntry(entries);
  if (!manifestEntry) {
    await markError(db, packageId, tenantId, "no_manifest");
    return { ok: false, errorCode: "no_manifest" };
  }

  const xml = await manifestEntry.async("string");
  const parsed = parseScormManifest(xml);
  if (!parsed.ok) {
    const errorCode: ScormErrorCode = parsed.error === "no_entry" ? "entry_missing" : parsed.error === "no_manifest" ? "no_manifest" : "invalid_manifest";
    await markError(db, packageId, tenantId, errorCode);
    return { ok: false, errorCode };
  }

  // El manifiesto pudo vivir bajo un directorio raíz común: el `entryHref`
  // resuelto por `parseScormManifest` es RELATIVO a ese directorio.
  const manifestDir = manifestEntry.name.includes("/") ? manifestEntry.name.slice(0, manifestEntry.name.lastIndexOf("/") + 1) : "";
  const resolvedEntryHref = `${manifestDir}${parsed.entryHref}`;

  const entryFile = entries.find((e) => e.name === resolvedEntryHref);
  if (!entryFile) {
    await markError(db, packageId, tenantId, "entry_missing");
    return { ok: false, errorCode: "entry_missing" };
  }

  const extractedPrefix = `${tenantId}/${packageId}/ext`;
  const uploaded: string[] = [];
  for (const entry of entries) {
    const sanitized = sanitizeScormPath(entry.name);
    if (!sanitized.ok) {
      // No debería ocurrir (ya se validó arriba) — deny-by-default: aborta y limpia.
      await cleanupUploaded(db, uploaded);
      await markError(db, packageId, tenantId, "unsafe_path");
      return { ok: false, errorCode: "unsafe_path" };
    }
    const bytes = await entry.async("uint8array");
    const destPath = `${extractedPrefix}/${sanitized.value}`;
    const { error } = await db.storage
      .from(BUCKET)
      .upload(destPath, bytes, { contentType: contentTypeFor(sanitized.value), upsert: true });
    if (error) {
      await cleanupUploaded(db, uploaded);
      await markError(db, packageId, tenantId, "storage_error");
      return { ok: false, errorCode: "storage_error" };
    }
    uploaded.push(destPath);
  }

  await db
    .from("scorm_packages")
    .update({
      status: "ready",
      scorm_version: parsed.version,
      entry_href: resolvedEntryHref,
      extracted_prefix: extractedPrefix,
      // Resumen ACOTADO — jamás el XML crudo completo.
      manifest: { version: parsed.version, entryHref: resolvedEntryHref, resourceCount: parsed.resourceCount },
      error_code: null,
      processed_at: new Date(deps.now).toISOString(),
    })
    .eq("id", packageId)
    .eq("tenant_id", tenantId);

  return { ok: true };
}

export interface ScormSweepDeps {
  readonly now: number;
}

export interface ScormSweepSummary {
  readonly reprocessed: number;
}

/** Reencola/reprocesa filas huérfanas: `uploaded` vieja (encolado falló) o `processing` vieja (worker murió a medias). */
export async function runScormSweep(db: SupabaseClient, deps: ScormSweepDeps): Promise<ScormSweepSummary> {
  const uploadedThreshold = new Date(deps.now - SWEEP_UPLOADED_STALE_MS).toISOString();
  const processingThreshold = new Date(deps.now - SWEEP_PROCESSING_STALE_MS).toISOString();

  const { data: stale } = await db
    .from("scorm_packages")
    .select("id, tenant_id")
    .or(
      `and(status.eq.uploaded,updated_at.lt.${uploadedThreshold}),and(status.eq.processing,updated_at.lt.${processingThreshold})`,
    );

  let reprocessed = 0;
  for (const row of stale ?? []) {
    await runScormExtract(db, { packageId: row.id as string, tenantId: row.tenant_id as string, now: deps.now });
    reprocessed++;
  }
  return { reprocessed };
}
