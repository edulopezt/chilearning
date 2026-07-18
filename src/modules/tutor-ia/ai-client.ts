/**
 * Cliente de IA — embeddings (task 5.8a) + chat streaming (task 5.8b).
 *
 * Decisión de Edu (2026-07-17, investigada esa misma noche): el proveedor es
 * OPENROUTER, no Anthropic directo.
 *   - Embeddings: `POST https://openrouter.ai/api/v1/embeddings`, compatible
 *     OpenAI (`{ model, input }` → `{ data: [{ embedding, index }] }`).
 *   - Chat streaming (5.8b): `POST https://openrouter.ai/api/v1/chat/completions`,
 *     body `{ model, messages, stream: true }`. El ÚLTIMO chunk SSE del stream
 *     SIEMPRE trae un objeto `usage` con el costo REAL en USD (`cost`) — sin
 *     necesitar ningún flag (`usage:{include:true}` está deprecado y no hace
 *     nada). Ver `domain/sse.ts` para el parseo exacto de ese chunk.
 *   - Auth: header `Authorization: Bearer <OPENROUTER_API_KEY>`.
 *   - ZDR (Zero Data Retention) es una responsabilidad OPERATIVA de Edu
 *     (Settings → Privacy de la cuenta OpenRouter) — el código NO puede
 *     verificar desde aquí que esté activada; es la base de RNF-10, no algo
 *     forzable en runtime.
 *
 * ⚠ SIN `import "server-only"`: lo usa también el worker de indexación
 * (`indexing.ts`/`tutor-maintenance.ts`), que corre fuera de Next. Mismo
 * patrón de fetch-directo-sin-SDK que `comunicacion/email-sender.ts` (Resend).
 * Degrada elegante sin key: `noopAiClient` — ningún flujo se bloquea por falta
 * de proveedor (FTS sigue funcionando sin esto).
 */

import { parseSseLine } from "@/modules/tutor-ia/domain/sse";

export interface EmbedSuccess {
  readonly ok: true;
  readonly vectors: (number[] | null)[];
}
export interface EmbedFailure {
  readonly ok: false;
  readonly error: string;
}
export type EmbedResult = EmbedSuccess | EmbedFailure;

/** Un turno de la conversación tal como lo espera el endpoint chat/completions. */
export interface ChatMessage {
  readonly role: string;
  readonly content: string;
}

/**
 * Un chunk YA NORMALIZADO del stream de chat (wire format propio, no el crudo
 * de OpenRouter — `chatStream` es la única puerta que traduce uno al otro).
 */
export interface ChatStreamChunk {
  readonly type: "delta" | "done" | "error";
  readonly text?: string;
  readonly usage?: { readonly promptTokens: number; readonly completionTokens: number; readonly costUsd: number };
  readonly error?: string;
}

export interface AiClient {
  readonly configured: boolean;
  /** Modelo de embeddings usado (para registrar en `course_chunks.embedding_model`). */
  readonly embeddingModel?: string;
  /** Modelo de chat usado (task 5.8b, informativo/diagnóstico). */
  readonly chatModel?: string;
  embed(texts: string[]): Promise<EmbedResult>;
  /** Streaming de chat (task 5.8b). Nunca lanza: los fallos se reportan como `{type:"error"}`. */
  chatStream(messages: ChatMessage[]): AsyncGenerator<ChatStreamChunk>;
}

export interface OpenRouterConfig {
  readonly apiKey: string;
  readonly embeddingModel: string;
  /** Modelo de chat (task 5.8b); default `DEFAULT_CHAT_MODEL` si no se fija. */
  readonly chatModel?: string;
  readonly fetchImpl?: typeof fetch;
  /** Headers opcionales recomendados por OpenRouter (atribución en su dashboard). */
  readonly referer?: string;
  readonly title?: string;
}

const OPENROUTER_EMBEDDINGS_ENDPOINT = "https://openrouter.ai/api/v1/embeddings";
const OPENROUTER_CHAT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";
// Alias-router de OpenRouter: apunta SIEMPRE al Haiku vigente (evita que el
// default quede obsoleto si Anthropic libera una versión nueva). Override
// por `OPENROUTER_MODEL` si Edu quiere fijar un modelo concreto.
export const DEFAULT_CHAT_MODEL = "anthropic/claude-haiku-latest";

interface OpenRouterEmbeddingItem {
  embedding?: number[];
  index?: number;
}
interface OpenRouterEmbeddingsResponse {
  data?: OpenRouterEmbeddingItem[];
}

/** Arma el POST a OpenRouter (puro, unit-testeable) — mismo patrón que `buildResendRequest`. */
export function buildEmbeddingsRequest(
  texts: string[],
  cfg: Pick<OpenRouterConfig, "apiKey" | "embeddingModel" | "referer" | "title">,
): { url: string; init: RequestInit } {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
  };
  if (cfg.referer) headers["HTTP-Referer"] = cfg.referer;
  if (cfg.title) headers["X-Title"] = cfg.title;
  return {
    url: OPENROUTER_EMBEDDINGS_ENDPOINT,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({ model: cfg.embeddingModel, input: texts }),
    },
  };
}

/** Arma el POST de chat streaming a OpenRouter (puro, unit-testeable). */
export function buildChatRequest(
  messages: ChatMessage[],
  cfg: Pick<OpenRouterConfig, "apiKey" | "chatModel" | "referer" | "title">,
): { url: string; init: RequestInit } {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
  };
  if (cfg.referer) headers["HTTP-Referer"] = cfg.referer;
  if (cfg.title) headers["X-Title"] = cfg.title;
  return {
    url: OPENROUTER_CHAT_ENDPOINT,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({ model: cfg.chatModel ?? DEFAULT_CHAT_MODEL, messages, stream: true }),
    },
  };
}

/**
 * Trocea el cuerpo de un stream por LÍNEAS, manteniendo un buffer de la línea
 * incompleta final entre lecturas: los chunks TCP pueden partir una línea SSE
 * a la mitad (`read()` no garantiza traer líneas completas).
 */
async function* readLines(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      yield buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }
  if (buffer.length > 0) yield buffer;
}

/** Generador real del streaming de chat contra OpenRouter. Nunca lanza. */
async function* chatStreamImpl(
  messages: ChatMessage[],
  cfg: OpenRouterConfig,
  fetchImpl: typeof fetch,
): AsyncGenerator<ChatStreamChunk> {
  const { url, init } = buildChatRequest(messages, cfg);

  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    console.error("[tutor-ia] fallo de red en el streaming de chat de OpenRouter", {
      message: (err as Error).message,
    });
    yield { type: "error", error: "network_error" };
    return;
  }

  if (!res.ok) {
    console.error("[tutor-ia] OpenRouter chat stream respondio error", { status: res.status });
    yield { type: "error", error: `openrouter_http_${res.status}` };
    return;
  }

  const body = res.body;
  if (!body) {
    yield { type: "error", error: "empty_body" };
    return;
  }

  const reader = body.getReader();
  try {
    for await (const line of readLines(reader)) {
      const parsed = parseSseLine(line);
      if (!parsed) continue;
      if (parsed.event === "delta" && parsed.text) {
        yield { type: "delta", text: parsed.text };
      } else if (parsed.event === "done") {
        yield { type: "done", usage: parsed.usage };
        return;
      }
      // "other": chunk válido sin texto emitible (p.ej. delta de solo rol) — se ignora y se sigue.
    }
  } catch (err) {
    console.error("[tutor-ia] fallo leyendo el stream de chat de OpenRouter", {
      message: (err as Error).message,
    });
    yield { type: "error", error: "stream_read_error" };
  } finally {
    // Libera el reader SIEMPRE (hallazgo de revisión de correctness,
    // 2026-07-18: ocurre en el 100% de las respuestas exitosas). El camino
    // feliz nunca llega a leer `data: [DONE]\n\n` (se hace `return` apenas
    // llega el chunk de `usage`) y el `break` del consumidor externo
    // (`tutor-chat-service.ts`, al recibir "done") dispara `IteratorClose`
    // sobre este generador — reanudado exactamente en el `yield` de arriba —
    // así que SIN este `finally` el reader queda sin cancelar en ambos
    // caminos, no solo en el de error. Sin cancelar/drenar, el socket
    // subyacente no vuelve al pool de keep-alive de forma determinística.
    await reader.cancel().catch(() => undefined);
  }
}

/** Cliente real contra OpenRouter. Nunca lanza: reporta `ok:false`. */
export function openRouterAiClient(cfg: OpenRouterConfig): AiClient {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  return {
    configured: true,
    embeddingModel: cfg.embeddingModel,
    chatModel: cfg.chatModel ?? DEFAULT_CHAT_MODEL,
    chatStream(messages: ChatMessage[]): AsyncGenerator<ChatStreamChunk> {
      return chatStreamImpl(messages, cfg, fetchImpl);
    },
    async embed(texts: string[]): Promise<EmbedResult> {
      if (texts.length === 0) return { ok: true, vectors: [] };
      const { url, init } = buildEmbeddingsRequest(texts, cfg);
      try {
        const res = await fetchImpl(url, init);
        if (!res.ok) {
          console.error("[tutor-ia] OpenRouter embeddings respondio error", { status: res.status });
          return { ok: false, error: `openrouter_http_${res.status}` };
        }
        const body = (await res.json().catch(() => null)) as OpenRouterEmbeddingsResponse | null;
        const items = body?.data ?? [];
        const vectors: (number[] | null)[] = new Array(texts.length).fill(null);
        for (const item of items) {
          const idx = item.index;
          if (typeof idx === "number" && idx >= 0 && idx < vectors.length && Array.isArray(item.embedding)) {
            vectors[idx] = item.embedding;
          }
        }
        return { ok: true, vectors };
      } catch (err) {
        console.error("[tutor-ia] fallo de red pidiendo embeddings a OpenRouter", {
          message: (err as Error).message,
        });
        return { ok: false, error: "network_error" };
      }
    },
  };
}

/** Generador defensivo del noop: nunca debería llamarse (el caller chequea `configured`
 *  antes), pero si algo cambia, no debe reventar — reporta `error` sin tocar red. */
async function* noopChatStream(): AsyncGenerator<ChatStreamChunk> {
  yield { type: "error", error: "not_configured" };
}

/** Cliente no-op para entornos sin proveedor: nunca llama red. */
export function noopAiClient(): AiClient {
  return {
    configured: false,
    async embed(): Promise<EmbedResult> {
      return { ok: false, error: "not_configured" };
    },
    chatStream(): AsyncGenerator<ChatStreamChunk> {
      return noopChatStream();
    },
  };
}

/** Cliente segun el entorno: OpenRouter si hay key; si no, no-op (degrada elegante). */
export function aiClientFromEnv(env: Record<string, string | undefined>): AiClient {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return noopAiClient();
  const embeddingModel = env.OPENROUTER_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
  const chatModel = env.OPENROUTER_MODEL?.trim() || DEFAULT_CHAT_MODEL;
  return openRouterAiClient({
    apiKey,
    embeddingModel,
    chatModel,
    referer: env.APP_BASE_URL?.trim() || undefined,
    title: "Chilearning",
  });
}
