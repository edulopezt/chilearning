// ⚠ SIN `import "server-only"`: lo ejecuta el proceso worker (jobs
// `descriptor-extract`/`descriptor-sweep`), fuera de Next. Imports RELATIVOS
// (el bundle de esbuild no resuelve el alias `@/`) y NADA que arrastre
// `server-only` — por eso este archivo NO importa `domain/course-wizard.ts`
// (arrastra `domain/course.ts`/`domain/lesson.ts`, que sí usan `@/`): el
// `state` del draft se actualiza acá con un objeto plano equivalente a
// `WizardState`, no con `hydrateWizardState`/`EMPTY_WIZARD_STATE` importados.
// Mismo patrón que `contenido/scorm-extract.ts` / `comunicacion/reminders.ts`.
import type { SupabaseClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import mammoth from "mammoth";

import { extractDescriptor } from "./domain/descriptor-extract";
import { exceedsDescriptorUncompressedBudget, MAX_DESCRIPTOR_UNCOMPRESSED_BYTES } from "./domain/descriptor-zip";

/**
 * Procesamiento del descriptor SENCE (.docx) del asistente de cursos (fix de
 * seguridad post-5.10, HU-3.5/4.5): el fix original del 4-ojos (HIGH/MED)
 * agregó un guardia anti zip-bomb, pero seguía descomprimiendo el .docx
 * INLINE en el proceso web compartido por TODOS los tenants — confiando
 * PRIMERO en el tamaño descomprimido DECLARADO en el directorio central del
 * .zip (100% controlado por quien sube el archivo) y llamando recién después
 * a `mammoth.extractRawText` sobre el buffer COMPLETO, que descomprime TODO
 * internamente sin ningún límite de bytes reales. Un .docx que MIENTE su
 * tamaño declarado (mismo ataque que `forgeDeclaredUncompressedSize` cazó en
 * `contenido/scorm-zip.ts`) pasaba ese pre-chequeo intacto y hacía que
 * `mammoth` igual inflara cientos de MB/GB antes de que el límite de
 * longitud de TEXTO pudiera rechazar algo — un OOM ahí tumba el proceso que
 * atiende a TODOS los tenants en vivo (peor radio de impacto que SCORM, que
 * ya corría aislado en el worker desde su origen, ADR-006).
 *
 * `runDescriptorExtract` mueve TODO ese trabajo acá: descarga el .docx desde
 * Storage, mide los bytes REALES de CADA entry del .zip en streaming contra
 * un presupuesto COMPARTIDO (`readEntryBytes`, idéntico patrón a
 * `scorm-extract.ts::readEntryBytes`) — la defensa que de verdad importa, no
 * el tamaño declarado — y SOLO si el total real se mantiene bajo presupuesto
 * deja que `mammoth` descomprima el buffer ORIGINAL completo (ya se sabe que
 * no puede explotar más de lo que se acaba de medir entry por entry).
 * `runDescriptorSweep` es la red de seguridad de drafts `processing`
 * huérfanos (encolado falló o el worker murió a medio proceso), mismo patrón
 * que `runScormSweep`.
 */

const BUCKET = "course_descriptors";
// Segunda barrera (además del streaming de bytes reales): acota el TEXTO ya
// extraído antes de pasarlo a `extractDescriptor` — un descriptor real
// (Anexo 4) son unas pocas páginas.
const MAX_DESCRIPTOR_TEXT_LENGTH = 2_000_000; // ~2 MB de texto plano
const SWEEP_PROCESSING_STALE_MS = 5 * 60 * 1000;

export type DescriptorErrorCode = "invalid_zip" | "too_large" | "text_too_large" | "storage_error";
export type DescriptorExtractResult = { ok: true } | { ok: false; errorCode: DescriptorErrorCode | "not_found" };

export interface DescriptorExtractDeps {
  readonly draftId: string;
  readonly tenantId: string;
  /**
   * SOLO PARA TESTS: acota el presupuesto de bytes REALES (no declarados)
   * que `readEntryBytes` tolera antes de abortar. El worker en producción
   * NUNCA pasa este campo (queda en `MAX_DESCRIPTOR_UNCOMPRESSED_BYTES` = 50
   * MB) — mismo hook que `ScormExtractDeps.uncompressedBudgetOverrideBytes`,
   * para no tener que inflar decenas de MB en cada corrida de CI.
   */
  readonly uncompressedBudgetOverrideBytes?: number;
}

async function insertAudit(
  db: SupabaseClient,
  tenantId: string,
  draftId: string,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from("audit_log").insert({
    tenant_id: tenantId,
    actor_user_id: null, // acción de sistema (worker), sin actor humano
    action,
    entity: "course_drafts",
    entity_id: draftId,
    details,
  });
  if (error) {
    console.error("[descriptor-extract] fallo escribiendo audit_log", { action, message: error.message, draftId });
  }
}

async function markFailed(
  db: SupabaseClient,
  draftId: string,
  tenantId: string,
  errorCode: DescriptorErrorCode,
): Promise<void> {
  await db
    .from("course_drafts")
    .update({ status: "failed", descriptor_error: errorCode })
    .eq("id", draftId)
    .eq("tenant_id", tenantId);
  await insertAudit(db, tenantId, draftId, "course_draft.descriptor_failed", { errorCode });
}

/**
 * Campo INTERNO de jszip (no forma parte de su `.d.ts` público): mismo
 * patrón y mismo aviso que `contenido/scorm-extract.ts::declaredUncompressedSize`
 * — se duplica acá (módulo `academico` no depende de `contenido` por un
 * detalle privado de implementación de una librería de terceros).
 */
function declaredUncompressedSize(entry: JSZip.JSZipObject): number {
  const raw = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
  return typeof raw?.uncompressedSize === "number" ? raw.uncompressedSize : 0;
}

class UncompressedBudgetExceededError extends Error {
  constructor() {
    super("uncompressed bytes exceeded the descriptor budget while streaming");
    this.name = "UncompressedBudgetExceededError";
  }
}

/**
 * `internalStream(type)` es un método PÚBLICO de jszip pero el `.d.ts`
 * empaquetado solo tipa `.async()`/`.nodeStream()`. Se tipa localmente (igual
 * que `scorm-extract.ts`) para engancharse a los eventos `data`/`end`/`error`
 * chunk a chunk.
 */
interface JSZipInternalStream {
  on(event: "data", cb: (data: Uint8Array) => void): JSZipInternalStream;
  on(event: "end", cb: () => void): JSZipInternalStream;
  on(event: "error", cb: (err: unknown) => void): JSZipInternalStream;
  pause(): JSZipInternalStream;
  resume(): JSZipInternalStream;
}
interface JSZipObjectWithInternalStream {
  internalStream(type: "uint8array"): JSZipInternalStream;
}

/**
 * Descomprime una entry en STREAMING, sumando los bytes REALES emitidos por
 * jszip contra un presupuesto acumulado y COMPARTIDO entre todas las entries
 * del .docx. Aborta apenas el acumulado real supera el presupuesto: pausa el
 * stream (que jszip propaga hacia arriba, deteniendo la inflación) y
 * rechaza la promesa en vez de esperar a terminar de inflar — idéntico
 * patrón que `contenido/scorm-extract.ts::readEntryBytes`.
 *
 * A diferencia de SCORM (que necesita los bytes reales de cada entry para
 * volver a subirlos a Storage), acá NO se necesita el contenido descomprimido
 * en sí — solo CONTARLO —, así que se descartan los chunks apenas se miden
 * (se resuelve con el total, no con un `Uint8Array`): mide el mismo volumen
 * real de bytes sin duplicar esa memoria en un buffer que de todos modos se
 * iba a descartar.
 */
function readEntryBytes(entry: JSZip.JSZipObject, budget: { remaining: number }): Promise<number> {
  return new Promise((resolve, reject) => {
    let total = 0;
    let settled = false;
    const stream = (entry as unknown as JSZipObjectWithInternalStream).internalStream("uint8array");
    stream
      .on("data", (data: Uint8Array) => {
        if (settled) return;
        total += data.length;
        budget.remaining -= data.length;
        if (budget.remaining < 0) {
          settled = true;
          stream.pause();
          reject(new UncompressedBudgetExceededError());
        }
      })
      .on("error", (err: unknown) => {
        if (settled) return;
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      })
      .on("end", () => {
        if (settled) return;
        settled = true;
        resolve(total);
      })
      .resume();
  });
}

export async function runDescriptorExtract(db: SupabaseClient, deps: DescriptorExtractDeps): Promise<DescriptorExtractResult> {
  const { draftId, tenantId } = deps;

  // Filtro por `status = 'processing'` (además de tenant/source): si el job
  // llega DUPLICADO (redelivery de BullMQ) o se cruza con el sweep, un draft
  // que ya avanzó a `in_progress` (el usuario ya lo está editando) o `failed`
  // NO se vuelve a tocar — evita pisar ediciones ya hechas en el wizard con
  // una reextracción vieja.
  const { data: draft } = await db
    .from("course_drafts")
    .select("descriptor_path, state")
    .eq("id", draftId)
    .eq("tenant_id", tenantId)
    .eq("source", "descriptor")
    .eq("status", "processing")
    .maybeSingle();
  if (!draft || !draft.descriptor_path) return { ok: false, errorCode: "not_found" };

  const dl = await db.storage.from(BUCKET).download(draft.descriptor_path as string);
  if (dl.error || !dl.data) {
    await markFailed(db, draftId, tenantId, "storage_error");
    return { ok: false, errorCode: "storage_error" };
  }
  const bytes = Buffer.from(await dl.data.arrayBuffer());

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    await markFailed(db, draftId, tenantId, "invalid_zip");
    return { ok: false, errorCode: "invalid_zip" };
  }
  const entries = Object.values(zip.files).filter((f) => !f.dir);

  // Pre-chequeo BARATO (sin IO) contra el tamaño DECLARADO: rechaza rápido lo
  // que declara honestamente ser enorme. NO es la defensa real — ver el
  // streaming de `readEntryBytes` más abajo, que mide bytes REALES mientras
  // se descomprime cada entry.
  const totalDeclared = entries.reduce((sum, e) => sum + declaredUncompressedSize(e), 0);
  if (exceedsDescriptorUncompressedBudget(totalDeclared)) {
    await markFailed(db, draftId, tenantId, "too_large");
    return { ok: false, errorCode: "too_large" };
  }

  // Defensa REAL: mide los bytes REALES de CADA entry del .zip (no solo
  // `word/document.xml` — cualquier entry adicional que mammoth necesite, o
  // que alguien agregue de más, comparte el MISMO presupuesto) antes de
  // dejar que `mammoth` descomprima el buffer completo. Un .zip que MIENTE
  // su tamaño declarado (`forgeDeclaredUncompressedSize` en los tests) queda
  // acotado igual por el volumen real de bytes procesados.
  const runtimeBudget = { remaining: deps.uncompressedBudgetOverrideBytes ?? MAX_DESCRIPTOR_UNCOMPRESSED_BYTES };
  try {
    for (const entry of entries) {
      await readEntryBytes(entry, runtimeBudget);
    }
  } catch (err) {
    if (!(err instanceof UncompressedBudgetExceededError)) throw err;
    await markFailed(db, draftId, tenantId, "too_large");
    return { ok: false, errorCode: "too_large" };
  }

  // Los bytes reales de TODAS las entries ya se midieron bajo presupuesto: es
  // seguro dejar que `mammoth` descomprima el buffer ORIGINAL completo (no
  // puede explotar más de lo que ya se acaba de medir entry por entry).
  let text: string;
  try {
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    text = value;
  } catch {
    await markFailed(db, draftId, tenantId, "invalid_zip");
    return { ok: false, errorCode: "invalid_zip" };
  }
  if (text.length > MAX_DESCRIPTOR_TEXT_LENGTH) {
    await markFailed(db, draftId, tenantId, "text_too_large");
    return { ok: false, errorCode: "text_too_large" };
  }

  const extract = extractDescriptor(text);
  // El draft nace con `state = EMPTY_WIZARD_STATE` (wizard-service.ts, al
  // crearlo) — se parte de esa base y se pisan SOLO los 4 campos que este
  // extractor siembra, sin importar `WizardState`/`hydrateWizardState` (ver
  // el aviso del encabezado del archivo sobre por qué este módulo no puede
  // arrastrar `domain/course-wizard.ts`).
  const baseState = (typeof draft.state === "object" && draft.state !== null ? draft.state : {}) as Record<string, unknown>;
  const nextState = {
    ...baseState,
    estructura: {
      modules: extract.modules.map((m, i) => ({
        id: `m${i + 1}`,
        title: m.title || `Módulo ${i + 1}`,
        hours: m.hours ?? 0,
      })),
    },
    datosSeed: { name: extract.name, hours: extract.totalHours },
    outcomesSeed: extract.outcomes,
    extractWarnings: extract.warnings,
  };

  const { error: updateError } = await db
    .from("course_drafts")
    .update({ status: "in_progress", state: nextState, descriptor_error: null })
    .eq("id", draftId)
    .eq("tenant_id", tenantId);
  if (updateError) {
    console.error("[descriptor-extract] no se pudo guardar el state extraído", {
      message: updateError.message,
      draftId,
    });
    await markFailed(db, draftId, tenantId, "storage_error");
    return { ok: false, errorCode: "storage_error" };
  }

  await insertAudit(db, tenantId, draftId, "course_draft.descriptor_processed", {});
  return { ok: true };
}

export interface DescriptorSweepDeps {
  readonly now: number;
}
export interface DescriptorSweepSummary {
  readonly reprocessed: number;
}

/**
 * Red de seguridad periódica: drafts `processing` huérfanos — el encolado
 * falló (Redis caído al crear el draft) o el worker murió a medio proceso.
 * El .docx sigue intacto en Storage (nunca se toca en el camino feliz), así
 * que reprocesar es seguro e idempotente. Mismo patrón que `runScormSweep`.
 */
export async function runDescriptorSweep(db: SupabaseClient, deps: DescriptorSweepDeps): Promise<DescriptorSweepSummary> {
  const threshold = new Date(deps.now - SWEEP_PROCESSING_STALE_MS).toISOString();
  const { data: stale } = await db
    .from("course_drafts")
    .select("id, tenant_id")
    .eq("source", "descriptor")
    .eq("status", "processing")
    .lt("updated_at", threshold);

  let reprocessed = 0;
  for (const row of stale ?? []) {
    await runDescriptorExtract(db, { draftId: row.id as string, tenantId: row.tenant_id as string });
    reprocessed++;
  }
  return { reprocessed };
}
