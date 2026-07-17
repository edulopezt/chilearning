// ⚠ SIN `import "server-only"`: lo ejecuta el worker (job `tutor-reconcile-tick`),
// fuera de Next. Imports RELATIVOS (mismo motivo que `indexing.ts`).
import type { SupabaseClient } from "@supabase/supabase-js";

import { aiClientFromEnv } from "./ai-client";
import { reindexLesson } from "./indexing";

/**
 * Mantenimiento diario del Tutor IA (task 5.8a, HU-11.3, worker `tutor-reconcile-tick`):
 *
 *  a) PURGA por retención propia: `tutor_conversations`/`tutor_messages` más
 *     viejos que `TUTOR_RETENTION_DAYS` (default 180) se BORRAN — HU-11.3
 *     ("interacciones con retención propia"). `tutor_messages` borra primero
 *     (FK `conversation_id` restrict la referencia); luego las conversaciones
 *     vacías resultantes.
 *  b) RECONCILE: re-chunkea lecciones `published`/`text` que no tengan NINGÚN
 *     chunk todavía — backfill de contenido creado ANTES de este PR, o de un
 *     fallo a medio camino del hook síncrono de publicación.
 */

export interface TutorReconcileSummary {
  readonly purgedMessages: number;
  readonly purgedConversations: number;
  readonly reindexed: number;
}

const DEFAULT_RETENTION_DAYS = 180;

function retentionDays(): number {
  const raw = Number(process.env.TUTOR_RETENTION_DAYS);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_RETENTION_DAYS;
}

async function purgeOldConversations(
  db: SupabaseClient,
  cutoffIso: string,
): Promise<{ purgedMessages: number; purgedConversations: number }> {
  const staleConversations = await db
    .from("tutor_conversations")
    .select("id")
    .lt("updated_at", cutoffIso);
  const ids = (staleConversations.data ?? []).map((r) => r.id as string);
  if (ids.length === 0) return { purgedMessages: 0, purgedConversations: 0 };

  const deletedMessages = await db.from("tutor_messages").delete().in("conversation_id", ids).select("id");
  const deletedConversations = await db.from("tutor_conversations").delete().in("id", ids).select("id");

  if (staleConversations.error) {
    console.error("[worker][tutor-reconcile] fallo listando conversaciones vencidas", {
      message: staleConversations.error.message,
    });
  }
  return {
    purgedMessages: deletedMessages.data?.length ?? 0,
    purgedConversations: deletedConversations.data?.length ?? 0,
  };
}

interface UnindexedLessonRow {
  id: string;
  tenant_id: string;
  course_id: string;
  title: string;
  kind: string;
  content: string;
  status: string;
}

/** Lecciones `text`+`published` sin NINGÚN chunk todavía (backfill). */
async function findUnindexedPublishedLessons(db: SupabaseClient): Promise<UnindexedLessonRow[]> {
  const { data: lessons, error } = await db
    .from("lessons")
    .select("id, tenant_id, course_id, title, kind, content, status")
    .eq("kind", "text")
    .eq("status", "published");
  if (error || !lessons) {
    if (error) console.error("[worker][tutor-reconcile] fallo listando lecciones", { message: error.message });
    return [];
  }
  if (lessons.length === 0) return [];

  const ids = lessons.map((l) => l.id as string);
  const { data: chunkRows, error: chunkError } = await db.from("course_chunks").select("lesson_id").in("lesson_id", ids);
  if (chunkError) {
    console.error("[worker][tutor-reconcile] fallo listando chunks existentes", { message: chunkError.message });
    return [];
  }
  const alreadyIndexed = new Set((chunkRows ?? []).map((r) => r.lesson_id as string));
  return (lessons as UnindexedLessonRow[]).filter((l) => !alreadyIndexed.has(l.id));
}

export async function runTutorReconcile(
  db: SupabaseClient,
  opts: { now: number },
): Promise<TutorReconcileSummary> {
  const cutoff = new Date(opts.now - retentionDays() * 24 * 60 * 60 * 1000).toISOString();
  const { purgedMessages, purgedConversations } = await purgeOldConversations(db, cutoff);

  const aiClient = aiClientFromEnv(process.env);
  const pending = await findUnindexedPublishedLessons(db);
  for (const lesson of pending) {
    await reindexLesson(db, { aiClient }, lesson);
  }

  return { purgedMessages, purgedConversations, reindexed: pending.length };
}
