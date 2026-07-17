import "server-only";

import type { TenantGuard } from "@/lib/tenant-guard";
import type { AiClient } from "@/modules/tutor-ia/ai-client";
import type { TutorPromptFragment } from "@/modules/tutor-ia/domain/prompt";

/**
 * Retrieval híbrido del Tutor IA (task 5.8a, ADR-007). `import "server-only"`:
 * consume `tenantGuard()`, jamás lo toca el worker (la indexación, que SÍ
 * corre en el worker, vive en `indexing.ts`, sin este import).
 *
 * RPC vs query directa (decisión): `websearch_to_tsquery` + `ts_rank`
 * (ordenar por relevancia) y la distancia coseno de pgvector (`<=>`) no son
 * expresables con el query builder de supabase-js — `.textSearch()` no
 * soporta ordenar por rank, y no hay forma de pedir `ORDER BY embedding <=> x`
 * desde el cliente REST. Por eso ambas búsquedas son RPCs SQL
 * (`search_course_chunks_lexical`/`_vector`, ver la migración
 * `20260717110000_tutor_ia_schema.sql`) llamadas SIEMPRE vía
 * `tenantGuard().db` (service-role) — el filtro de tenant real es el
 * parámetro `p_tenant_id` explícito, no RLS (que el service-role bypassa).
 */

interface ChunkRow {
  chunk_index: number;
  lesson_id: string;
  lesson_title: string;
  content: string;
}

function toFragments(rows: ChunkRow[]): TutorPromptFragment[] {
  return rows.map((r, i) => ({
    n: i + 1,
    lessonId: r.lesson_id,
    lessonTitle: r.lesson_title,
    text: r.content,
  }));
}

export async function searchChunksLexical(
  guard: TenantGuard,
  courseId: string,
  query: string,
  k = 6,
): Promise<TutorPromptFragment[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const { data, error } = await guard.db.rpc("search_course_chunks_lexical", {
    p_tenant_id: guard.tenantId,
    p_course_id: courseId,
    p_query: trimmed,
    p_k: k,
  });
  if (error || !data) {
    if (error) console.error("[tutor-ia] fallo el retrieval lexical", { message: error.message });
    return [];
  }
  return toFragments(data as ChunkRow[]);
}

export async function searchChunksVector(
  guard: TenantGuard,
  courseId: string,
  queryEmbedding: number[],
  k = 6,
): Promise<TutorPromptFragment[]> {
  const { data, error } = await guard.db.rpc("search_course_chunks_vector", {
    p_tenant_id: guard.tenantId,
    p_course_id: courseId,
    p_embedding: queryEmbedding,
    p_k: k,
  });
  if (error || !data) {
    if (error) console.error("[tutor-ia] fallo el retrieval vectorial", { message: error.message });
    return [];
  }
  return toFragments(data as ChunkRow[]);
}

/**
 * Orquestador híbrido: si `aiClient.configured`, intenta el embedding de la
 * pregunta y busca por similitud vectorial; si el cliente no está configurado
 * O la llamada de embeddings falla, cae SIEMPRE a FTS lexical — el alumno
 * nunca se queda sin retrieval por un fallo transitorio del proveedor.
 */
export async function searchChunks(
  guard: TenantGuard,
  aiClient: AiClient,
  courseId: string,
  query: string,
  k = 6,
): Promise<{ fragments: TutorPromptFragment[]; mode: "vector" | "lexical" }> {
  if (aiClient.configured) {
    const embedResult = await aiClient.embed([query]);
    const vector = embedResult.ok ? embedResult.vectors[0] : null;
    if (vector) {
      return { fragments: await searchChunksVector(guard, courseId, vector, k), mode: "vector" };
    }
  }
  return { fragments: await searchChunksLexical(guard, courseId, query, k), mode: "lexical" };
}
