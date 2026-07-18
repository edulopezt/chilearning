/**
 * Parser PURO de una línea de un stream SSE OpenRouter/OpenAI-compatible
 * (task 5.8a — la 5.8b lo consume para el streaming del chat). OpenRouter/
 * OpenAI mandan líneas `data: {...}` con `choices[0].delta.content` para el
 * texto incremental, y `data: [DONE]` al final. Nunca lanza: una línea
 * malformada devuelve `null` en vez de reventar el consumidor.
 *
 * Task 5.8b: OpenRouter SIEMPRE manda, en el ÚLTIMO chunk del stream, un
 * objeto `usage` con el costo REAL en USD (`cost`) — ese chunk llega SIN
 * `choices` (o con `choices: []`). La extracción de `usage` es INDEPENDIENTE
 * de si hay `choices`: un chunk sin `choices` pero CON `usage` es `"done"`
 * (antes se descartaba como `"other"`, perdiendo el costo real siempre).
 */

export interface SseParseResult {
  readonly event: "delta" | "done" | "other";
  readonly text?: string;
  readonly finishReason?: string;
  readonly usage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly costUsd: number;
  };
}

interface OpenRouterChunk {
  choices?: {
    delta?: { content?: string; role?: string };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
  };
}

function extractUsage(raw: OpenRouterChunk["usage"]): SseParseResult["usage"] {
  if (!raw) return undefined;
  return {
    promptTokens: typeof raw.prompt_tokens === "number" ? raw.prompt_tokens : 0,
    completionTokens: typeof raw.completion_tokens === "number" ? raw.completion_tokens : 0,
    costUsd: typeof raw.cost === "number" ? raw.cost : 0,
  };
}

export function parseSseLine(line: string): SseParseResult | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || !trimmed.startsWith("data:")) return null;

  const payload = trimmed.slice("data:".length).trim();
  if (payload === "[DONE]") return { event: "done" };
  if (payload.length === 0) return null;

  let parsed: OpenRouterChunk;
  try {
    parsed = JSON.parse(payload) as OpenRouterChunk;
  } catch {
    return null;
  }

  const usage = extractUsage(parsed.usage);
  const choice = parsed.choices?.[0];
  if (!choice) {
    // Sin `choices` (o `choices: []`): el chunk final de `usage` SIEMPRE llega
    // así. Con `usage` presente es "done" (con el costo real); sin él, es un
    // chunk realmente vacío/desconocido.
    return usage ? { event: "done", usage } : { event: "other" };
  }

  if (typeof choice.finish_reason === "string" && choice.finish_reason.length > 0) {
    return usage ? { event: "done", finishReason: choice.finish_reason, usage } : { event: "done", finishReason: choice.finish_reason };
  }

  const text = choice.delta?.content;
  if (typeof text === "string" && text.length > 0) {
    return { event: "delta", text };
  }

  // Delta "vacío" (solo trae `role: "assistant"`, sin contenido): válido,
  // pero no hay texto que emitir todavía.
  return { event: "other" };
}
