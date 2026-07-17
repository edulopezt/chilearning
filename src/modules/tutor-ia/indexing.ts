// ⚠ SIN `import "server-only"`: lo ejecuta también el worker (`tutor-maintenance.ts`,
// job `tutor-reconcile-tick`), que corre fuera de Next. Imports RELATIVOS (el
// bundle de esbuild no resuelve el alias `@/`) y NADA que arrastre
// `server-only`. Mismo patrón que `contenido/scorm-extract.ts`.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AiClient } from "./ai-client";
import { chunkLessonContent } from "./domain/chunking";

/**
 * Indexación de lecciones para el Tutor IA (task 5.8a, HU-11.1, ADR-007).
 *
 * Se dispara desde DOS lugares:
 *   1. SÍNCRONO: `lesson-service.ts` (create/update de una lección), justo
 *      después de un guardado exitoso — decisión de Edu/diseño: el chunking +
 *      FTS son baratos y locales (sin red); el único costo de red es
 *      `aiClient.embed()`, y es aceptable que un guardado admin tarde un poco
 *      más (no es una subida masiva de archivos ni una ruta de alumno). Se
 *      prefirió esto a encolar un job (`src/lib/queue.ts`) para mantener este
 *      PR acotado — si en producción el guardado se siente lento, migrar a
 *      encolado es un cambio de una función, no de esquema.
 *   2. ASÍNCRONO/backfill: `tutor-maintenance.ts` (worker, job diario) — re-
 *      chunkea lecciones publicadas sin chunks (contenido creado antes de este
 *      PR, o si el hook síncrono falló a medias).
 */

export interface IndexableLesson {
  readonly id: string;
  readonly tenant_id: string;
  readonly course_id: string;
  readonly title: string;
  readonly kind: string;
  readonly content: string;
  readonly status: string;
}

export interface IndexingDeps {
  readonly aiClient: AiClient;
}

/**
 * Reindexa UNA lección. Solo las de `kind="text"` Y `status="published"` son
 * indexables (HU-11.1): si el contenido no está a la vista del alumno,
 * tampoco debe ser recuperable por el tutor. Si no cumple, borra cualquier
 * chunk viejo (despublicación / cambio de kind) y retorna.
 */
export async function reindexLesson(
  db: SupabaseClient,
  deps: IndexingDeps,
  lesson: IndexableLesson,
): Promise<void> {
  if (lesson.kind !== "text" || lesson.status !== "published") {
    const { error } = await db.from("course_chunks").delete().eq("lesson_id", lesson.id);
    if (error) {
      console.error("[tutor-ia] fallo borrando chunks de una leccion no indexable", {
        lessonId: lesson.id,
        message: error.message,
      });
    }
    return;
  }

  const chunks = chunkLessonContent(lesson.title, lesson.content);

  // delete-then-insert: supabase-js no expone una transaccion multi-statement
  // desde el cliente REST, asi que esto NO es atomico. Aceptable: el peor
  // caso es una ventana breve sin chunks para ESTA leccion (no un dato
  // corrupto) -- FTS/embeddings son indices DERIVADOS y regenerables; el
  // reconcile diario del worker backfillea cualquier leccion que quede sin
  // chunks por una falla a medio camino.
  const del = await db.from("course_chunks").delete().eq("lesson_id", lesson.id);
  if (del.error) {
    console.error("[tutor-ia] fallo borrando chunks previos", { lessonId: lesson.id, message: del.error.message });
    return;
  }
  if (chunks.length === 0) return;

  const rows = chunks.map((c) => ({
    tenant_id: lesson.tenant_id,
    course_id: lesson.course_id,
    lesson_id: lesson.id,
    chunk_index: c.chunkIndex,
    lesson_title: lesson.title,
    content: c.text,
  }));
  const { data: inserted, error: insertError } = await db
    .from("course_chunks")
    .insert(rows)
    .select("id, chunk_index");
  if (insertError || !inserted) {
    console.error("[tutor-ia] fallo insertando chunks", { lessonId: lesson.id, message: insertError?.message });
    return;
  }

  // Sin proveedor de IA: los chunks quedan solo con FTS (fallback SIEMPRE
  // disponible) -- no es un fallo, es el modo por defecto sin OPENROUTER_API_KEY.
  if (!deps.aiClient.configured) return;

  const embedResult = await deps.aiClient.embed(chunks.map((c) => c.text));
  if (!embedResult.ok) {
    // NO es fatal: los chunks quedan CON contenido/tsvector (FTS funciona);
    // el retrieval hibrido cae a lexical automaticamente (`retrieval.ts`).
    console.warn("[tutor-ia] embeddings no disponibles; los chunks quedan solo con FTS", {
      lessonId: lesson.id,
      error: embedResult.error,
    });
    return;
  }

  const idByChunkIndex = new Map(inserted.map((r) => [r.chunk_index as number, r.id as string]));
  for (const chunk of chunks) {
    const vector = embedResult.vectors[chunk.chunkIndex];
    const rowId = idByChunkIndex.get(chunk.chunkIndex);
    if (!vector || !rowId) continue;
    const { error: updateError } = await db
      .from("course_chunks")
      .update({ embedding: vector, embedding_model: deps.aiClient.embeddingModel ?? null })
      .eq("id", rowId);
    if (updateError) {
      console.error("[tutor-ia] fallo guardando el embedding de un chunk", {
        lessonId: lesson.id,
        chunkIndex: chunk.chunkIndex,
        message: updateError.message,
      });
    }
  }
}
