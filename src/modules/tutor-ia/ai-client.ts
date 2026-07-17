/**
 * Cliente de IA — SOLO embeddings en este PR (task 5.8a). El chat/streaming
 * llega en la 5.8b, en este mismo archivo o uno nuevo.
 *
 * Decisión de Edu (2026-07-17, investigada esa misma noche): el proveedor es
 * OPENROUTER, no Anthropic directo.
 *   - Endpoint: `POST https://openrouter.ai/api/v1/embeddings`, compatible
 *     OpenAI (`{ model, input }` → `{ data: [{ embedding, index }] }`).
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

export interface EmbedSuccess {
  readonly ok: true;
  readonly vectors: (number[] | null)[];
}
export interface EmbedFailure {
  readonly ok: false;
  readonly error: string;
}
export type EmbedResult = EmbedSuccess | EmbedFailure;

export interface AiClient {
  readonly configured: boolean;
  /** Modelo de embeddings usado (para registrar en `course_chunks.embedding_model`). */
  readonly embeddingModel?: string;
  embed(texts: string[]): Promise<EmbedResult>;
}

export interface OpenRouterConfig {
  readonly apiKey: string;
  readonly embeddingModel: string;
  readonly fetchImpl?: typeof fetch;
  /** Headers opcionales recomendados por OpenRouter (atribución en su dashboard). */
  readonly referer?: string;
  readonly title?: string;
}

const OPENROUTER_EMBEDDINGS_ENDPOINT = "https://openrouter.ai/api/v1/embeddings";
export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";

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

/** Cliente real contra OpenRouter. Nunca lanza: reporta `ok:false`. */
export function openRouterAiClient(cfg: OpenRouterConfig): AiClient {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  return {
    configured: true,
    embeddingModel: cfg.embeddingModel,
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

/** Cliente no-op para entornos sin proveedor: nunca llama red. */
export function noopAiClient(): AiClient {
  return {
    configured: false,
    async embed(): Promise<EmbedResult> {
      return { ok: false, error: "not_configured" };
    },
  };
}

/** Cliente segun el entorno: OpenRouter si hay key; si no, no-op (degrada elegante). */
export function aiClientFromEnv(env: Record<string, string | undefined>): AiClient {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return noopAiClient();
  const embeddingModel = env.OPENROUTER_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
  return openRouterAiClient({
    apiKey,
    embeddingModel,
    referer: env.APP_BASE_URL?.trim() || undefined,
    title: "Chilearning",
  });
}
