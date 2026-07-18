import { describe, expect, it } from "vitest";

import { parseSseLine } from "./sse";

// Fixtures grabadas del formato real OpenRouter/OpenAI chat.completions (stream: true).
const DELTA_WITH_TEXT = 'data: {"id":"gen-1","choices":[{"index":0,"delta":{"content":"Hola"},"finish_reason":null}]}';
const DELTA_ROLE_ONLY = 'data: {"id":"gen-1","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}';
const DONE_LINE = "data: [DONE]";
const FINISH_LENGTH = 'data: {"id":"gen-1","choices":[{"index":0,"delta":{},"finish_reason":"length"}]}';
const MALFORMED = "data: {esto no es json valido";
const NOT_DATA_LINE = "event: ping";
const EMPTY_LINE = "";
// Chunk final REAL de OpenRouter (investigado en vivo, 5.8b): sin `choices`
// (o `choices: []`), con el objeto `usage` que trae el costo REAL en USD.
const USAGE_ONLY_NO_CHOICES = 'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":45,"cost":0.000034}}';
const FINISH_WITH_USAGE =
  'data: {"id":"gen-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"cost":0.000001}}';

describe("parseSseLine (OpenRouter/OpenAI-compatible, puro)", () => {
  it("delta con texto → event delta con el texto", () => {
    expect(parseSseLine(DELTA_WITH_TEXT)).toEqual({ event: "delta", text: "Hola" });
  });

  it("delta vacío de rol (solo role, sin content) → event other, sin texto", () => {
    expect(parseSseLine(DELTA_ROLE_ONLY)).toEqual({ event: "other" });
  });

  it("data: [DONE] → event done", () => {
    expect(parseSseLine(DONE_LINE)).toEqual({ event: "done" });
  });

  it("finish_reason: length → event done con finishReason", () => {
    expect(parseSseLine(FINISH_LENGTH)).toEqual({ event: "done", finishReason: "length" });
  });

  it("línea malformada → null, nunca lanza", () => {
    expect(() => parseSseLine(MALFORMED)).not.toThrow();
    expect(parseSseLine(MALFORMED)).toBeNull();
  });

  it("línea que no es de datos SSE (event:, comentario, vacía) → null", () => {
    expect(parseSseLine(NOT_DATA_LINE)).toBeNull();
    expect(parseSseLine(EMPTY_LINE)).toBeNull();
    expect(parseSseLine(":heartbeat")).toBeNull();
  });

  it("sin choices → event other (no lanza, no asume estructura)", () => {
    expect(parseSseLine('data: {"id":"gen-1","choices":[]}')).toEqual({ event: "other" });
  });

  it("chunk final SIN choices pero CON usage → event done con el usage (5.8b: antes se perdía como 'other')", () => {
    expect(parseSseLine(USAGE_ONLY_NO_CHOICES)).toEqual({
      event: "done",
      usage: { promptTokens: 120, completionTokens: 45, costUsd: 0.000034 },
    });
  });

  it("finish_reason Y usage en el mismo chunk → ambos se propagan", () => {
    expect(parseSseLine(FINISH_WITH_USAGE)).toEqual({
      event: "done",
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 2, costUsd: 0.000001 },
    });
  });
});
