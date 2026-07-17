import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { writeAudit } from "@/lib/audit";
import { requireFeature } from "@/lib/feature-flags";
import { enqueueScormExtract } from "@/lib/queue";
import { tenantGuard, type TenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";

/**
 * Ingesta de paquetes SCORM (task 5.1a, HU-4.2, ADR-006): sube el .zip a
 * Storage bajo `tenantGuard()` y encola la extracción/validación en el WORKER
 * (nunca en el request web — RNF-6, paquetes de cursos largos pueden pesar
 * cientos de MB). El reproductor (scorm-again) es la task 5.1b.
 */

const MANAGERS = ["otec_admin", "coordinator"] as const;
const BUCKET = "scorm";
const MAX_ZIP_BYTES = 250 * 1024 * 1024; // 250 MB — igual al límite del bucket
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"
const ALLOWED_ZIP_MIME: readonly string[] = ["application/zip", "application/x-zip-compressed"];

export type ScormError =
  | "no_tenant"
  | "forbidden"
  | "feature_disabled"
  | "invalid"
  | "course_not_found"
  | "storage_error"
  | "not_found"
  | "in_use";

export type ScormUploadResult = { ok: true; packageId: string } | { ok: false; error: ScormError };
export type ScormMutationResult = { ok: true } | { ok: false; error: ScormError };

export interface ScormPackageRow {
  id: string;
  course_id: string;
  title: string;
  status: "uploaded" | "processing" | "ready" | "error";
  scorm_version: string | null;
  error_code: string | null;
  file_size: number | null;
  created_at: string;
}

function canManage(p: Principal): boolean {
  return Boolean(p.tenantId) && authorize(p, p.tenantId!, MANAGERS);
}

/** Magic bytes reales del .zip ("PK\x03\x04"): el MIME que declara el navegador no basta. */
function hasZipMagic(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes.slice(0, 4));
  return head.length === 4 && ZIP_MAGIC.every((b, i) => head[i] === b);
}

export interface ScormUploadInput {
  readonly title: string;
  readonly file: { readonly name: string; readonly type: string; readonly size: number; readonly bytes: ArrayBuffer };
}

export interface ScormUploadTestHooks {
  /**
   * SOLO PARA TESTS: si se pasa, se usa este cliente (en vez del service-role
   * de `guard.db`, que BYPASSA RLS y no puede bloquearse con una policy) para
   * el UPDATE que enlaza `zip_path` tras la subida — permite reproducir un
   * fallo REAL de esa escritura puntual (p.ej. un cliente sin privilegio
   * UPDATE sobre `scorm_packages`, como `anon`) sin depender de SQL crudo.
   */
  readonly linkDbOverride?: SupabaseClient;
}

export async function uploadScormPackage(
  principal: Principal,
  courseId: string,
  input: ScormUploadInput,
  testHooks: ScormUploadTestHooks = {},
): Promise<ScormUploadResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  const guard = tenantGuard(principal.tenantId);

  if (!(await requireFeature(guard, principal.tenantId, "scorm"))) {
    return { ok: false, error: "feature_disabled" };
  }
  if (!canManage(principal)) return { ok: false, error: "forbidden" };

  const title = input.title.trim();
  if (title.length < 1 || title.length > 200) return { ok: false, error: "invalid" };
  if (input.file.size <= 0 || input.file.size > MAX_ZIP_BYTES) return { ok: false, error: "invalid" };
  if (!ALLOWED_ZIP_MIME.includes(input.file.type)) return { ok: false, error: "invalid" };
  if (!hasZipMagic(input.file.bytes)) return { ok: false, error: "invalid" };

  const { data: course } = await guard.from("courses").select("id").eq("id", courseId).maybeSingle();
  if (!course) return { ok: false, error: "course_not_found" };

  // Inserta PRIMERO (necesita el id para armar el path del objeto), sube el
  // .zip después. Si la subida falla, se compensa borrando la fila (patrón
  // `assignment-service.ts`): nunca debe quedar una fila apuntando a un
  // objeto de Storage que no existe.
  const { data: row, error: insertError } = await guard.db
    .from("scorm_packages")
    .insert(
      guard.withTenant({
        course_id: courseId,
        title,
        status: "uploaded",
        zip_path: "",
        file_size: input.file.size,
        uploaded_by: principal.userId,
      }),
    )
    .select("id")
    .single();
  if (insertError || !row) return { ok: false, error: "storage_error" };
  const packageId = row.id as string;

  const path = `${principal.tenantId}/${packageId}/package.zip`;
  const { error: uploadError } = await guard.db.storage
    .from(BUCKET)
    .upload(path, input.file.bytes, { contentType: input.file.type, upsert: false });
  if (uploadError) {
    await guard.db.from("scorm_packages").delete().eq("id", packageId).eq("tenant_id", principal.tenantId);
    return { ok: false, error: "storage_error" };
  }

  const linkDb = testHooks.linkDbOverride ?? guard.db;
  const { error: linkError } = await linkDb
    .from("scorm_packages")
    .update({ zip_path: path })
    .eq("id", packageId)
    .eq("tenant_id", principal.tenantId);
  if (linkError) {
    // Compensa: si esta escritura falla, la fila quedaría con `zip_path: ""`
    // (el placeholder del insert) apuntando a NADA, mientras el .zip real
    // queda huérfano en Storage — el worker jamás podría recuperarla (ver
    // `retryScormPackage`, que no toca `zip_path`). Se limpia AMBOS lados.
    await guard.db.storage.from(BUCKET).remove([path]);
    await guard.db.from("scorm_packages").delete().eq("id", packageId).eq("tenant_id", principal.tenantId);
    return { ok: false, error: "storage_error" };
  }

  // Encolado best-effort: si Redis no está disponible, la fila queda
  // `uploaded` y el `scorm-sweep` periódico del worker la recoge igual — la
  // subida NUNCA se aborta por un fallo de encolado.
  await enqueueScormExtract(packageId, principal.tenantId);

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "scorm.package_uploaded",
    entity: "scorm_packages",
    entityId: packageId,
    details: { courseId, fileName: input.file.name.slice(0, 300), fileSize: input.file.size },
  });

  return { ok: true, packageId };
}

const LIST_COLUMNS = "id, course_id, title, status, scorm_version, error_code, file_size, created_at";

export async function listScormPackages(principal: Principal, courseId: string): Promise<ScormPackageRow[]> {
  if (!principal.tenantId || !canManage(principal)) return [];
  const guard = tenantGuard(principal.tenantId);
  const { data } = await guard
    .from("scorm_packages")
    .select(LIST_COLUMNS)
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });
  return (data ?? []) as ScormPackageRow[];
}

/** Solo si `status = error`: la vuelve a `uploaded` y reencola. */
export async function retryScormPackage(principal: Principal, packageId: string): Promise<ScormMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const guard = tenantGuard(principal.tenantId);

  const { data, error } = await guard.db
    .from("scorm_packages")
    .update({ status: "uploaded", error_code: null })
    .eq("id", packageId)
    .eq("tenant_id", principal.tenantId)
    .eq("status", "error")
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "not_found" };

  await enqueueScormExtract(packageId, principal.tenantId);
  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "scorm.package_retry",
    entity: "scorm_packages",
    entityId: packageId,
  });
  return { ok: true };
}

/** Borrado recursivo best-effort de un prefijo de Storage (no bloqueante si falla). */
async function removeStoragePrefixBestEffort(guard: TenantGuard, prefix: string): Promise<void> {
  try {
    const paths = await listAllStorageFiles(guard, prefix, 0);
    if (paths.length > 0) await guard.db.storage.from(BUCKET).remove(paths);
  } catch {
    // Best-effort: un fallo aquí no bloquea el borrado de la fila.
  }
}

async function listAllStorageFiles(guard: TenantGuard, prefix: string, depth: number): Promise<string[]> {
  if (depth > 20) return []; // cota de profundidad, defensiva
  const { data } = await guard.db.storage.from(BUCKET).list(prefix, { limit: 1000 });
  const out: string[] = [];
  for (const entry of data ?? []) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      out.push(...(await listAllStorageFiles(guard, path, depth + 1)));
    } else {
      out.push(path);
    }
  }
  return out;
}

/** Rechaza si alguna lección `kind=scorm` referencia este paquete (en uso). */
export async function deleteScormPackage(principal: Principal, packageId: string): Promise<ScormMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const guard = tenantGuard(principal.tenantId);

  const { data: pkg } = await guard.from("scorm_packages").select("id").eq("id", packageId).maybeSingle();
  if (!pkg) return { ok: false, error: "not_found" };

  const { data: usage } = await guard.db
    .from("lessons")
    .select("id")
    .eq("tenant_id", principal.tenantId)
    .eq("kind", "scorm")
    .eq("content", packageId)
    .limit(1)
    .maybeSingle();
  if (usage) return { ok: false, error: "in_use" };

  await removeStoragePrefixBestEffort(guard, `${principal.tenantId}/${packageId}`);

  const { error } = await guard.db.from("scorm_packages").delete().eq("id", packageId).eq("tenant_id", principal.tenantId);
  if (error) return { ok: false, error: "storage_error" };

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "scorm.package_deleted",
    entity: "scorm_packages",
    entityId: packageId,
  });
  return { ok: true };
}
