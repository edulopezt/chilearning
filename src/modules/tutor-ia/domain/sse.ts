/**
 * Parser PURO de una línea de un stream SSE OpenRouter/OpenAI-compatible
 * (task 5.8a — la 5.8b lo consume para el streaming del chat). OpenRouter/
 * OpenAI mandan líneas `data: {...}` con `choices[0].delta.content` para el
 * texto incremental, y `data: [DONE]` al final. Nunca lanza: una línea
 * malformada devuelve `null` en vez de reventar el consumidor.
 */

export interface SseParseResult {
  readonly event: "delta" | "done" | "other";
  readonly text?: string;
  readonly finishReason?: string;
}

interface OpenRouterChunk {
  choices?: {
    delta?: { content?: string; role?: string };
    finish_reason?: string | null;
  }[];
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

  const choice = parsed.choices?.[0];
  if (!choice) return { event: "other" };

  if (typeof choice.finish_reason === "string" && choice.finish_reason.length > 0) {
    return { event: "done", finishReason: choice.finish_reason };
  }

  const text = choice.delta?.content;
  if (typeof text === "string" && text.length > 0) {
    return { event: "delta", text };
  }

  // Delta "vacío" (solo trae `role: "assistant"`, sin contenido): válido,
  // pero no hay texto que emitir todavía.
  return { event: "other" };
}
