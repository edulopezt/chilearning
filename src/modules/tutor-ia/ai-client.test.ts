import { describe, expect, it } from "vitest";

import {
  aiClientFromEnv,
  buildChatRequest,
  buildEmbeddingsRequest,
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  noopAiClient,
  openRouterAiClient,
  type ChatStreamChunk,
} from "./ai-client";

/** Junta un stream SSE fragmentado A PROPÓSITO en varios `enqueue()` — incluye
 *  un delta partido a mitad de línea (prueba el buffering de `readLines`),
 *  el chunk final de `usage` y `data: [DONE]`. */
function fakeChatSseResponse(): Response {
  const encoder = new TextEncoder();
  const fullLine = 'data: {"id":"gen-1","choices":[{"index":0,"delta":{"content":"Hola"},"finish_reason":null}]}\n\n';
  const splitPoint = Math.floor(fullLine.length / 2);
  const part1 = fullLine.slice(0, splitPoint);
  const part2 = fullLine.slice(splitPoint);
  const usageLine = 'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4,"cost":0.000007}}\n\n';
  const doneLine = "data: [DONE]\n\n";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(part1));
      controller.enqueue(encoder.encode(part2));
      controller.enqueue(encoder.encode(usageLine));
      controller.enqueue(encoder.encode(doneLine));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe("buildEmbeddingsRequest (puro)", () => {
  it("arma el POST correcto con Bearer y body OpenAI-compatible", () => {
    const { url, init } = buildEmbeddingsRequest(["hola", "mundo"], {
      apiKey: "or_test",
      embeddingModel: "openai/text-embedding-3-small",
    });
    expect(url).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer or_test");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "openai/text-embedding-3-small",
      input: ["hola", "mundo"],
    });
  });

  it("agrega HTTP-Referer y X-Title solo cuando vienen", () => {
    const { init } = buildEmbeddingsRequest(["x"], { apiKey: "k", embeddingModel: "m" });
    expect(init.headers as Record<string, string>).not.toHaveProperty("HTTP-Referer");

    const withHeaders = buildEmbeddingsRequest(["x"], {
      apiKey: "k",
      embeddingModel: "m",
      referer: "https://chilearning.cl",
      title: "Chilearning",
    });
    expect((withHeaders.init.headers as Record<string, string>)["HTTP-Referer"]).toBe("https://chilearning.cl");
    expect((withHeaders.init.headers as Record<string, string>)["X-Title"]).toBe("Chilearning");
  });
});

describe("openRouterAiClient (fetch inyectado — jamas la API real)", () => {
  it("2xx: respeta el indice de cada embedding en la respuesta", async () => {
    const client = openRouterAiClient({
      apiKey: "k",
      embeddingModel: "m",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [
              { embedding: [0.2, 0.3], index: 1 },
              { embedding: [0.1, 0.1], index: 0 },
            ],
          }),
          { status: 200 },
        ),
    });
    const result = await client.embed(["a", "b"]);
    expect(result).toEqual({ ok: true, vectors: [[0.1, 0.1], [0.2, 0.3]] });
  });

  it("respuesta incompleta (falta un indice): ese vector queda null, sin lanzar", async () => {
    const client = openRouterAiClient({
      apiKey: "k",
      embeddingModel: "m",
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [{ embedding: [0.1], index: 0 }] }), { status: 200 }),
    });
    const result = await client.embed(["a", "b"]);
    expect(result).toEqual({ ok: true, vectors: [[0.1], null] });
  });

  it("4xx -> ok:false con el status (sin lanzar)", async () => {
    const client = openRouterAiClient({
      apiKey: "k",
      embeddingModel: "m",
      fetchImpl: async () => new Response("{}", { status: 429 }),
    });
    expect(await client.embed(["a"])).toEqual({ ok: false, error: "openrouter_http_429" });
  });

  it("fallo de red -> ok:false network_error (sin lanzar)", async () => {
    const client = openRouterAiClient({
      apiKey: "k",
      embeddingModel: "m",
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      },
    });
    expect(await client.embed(["a"])).toEqual({ ok: false, error: "network_error" });
  });

  it("texts vacio: ok sin llamar red", async () => {
    let called = false;
    const client = openRouterAiClient({
      apiKey: "k",
      embeddingModel: "m",
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });
    expect(await client.embed([])).toEqual({ ok: true, vectors: [] });
    expect(called).toBe(false);
  });

  it("expone embeddingModel para que la indexacion registre que modelo se uso", () => {
    const client = openRouterAiClient({ apiKey: "k", embeddingModel: "modelo-x" });
    expect(client.embeddingModel).toBe("modelo-x");
    expect(client.configured).toBe(true);
  });
});

describe("buildChatRequest (puro)", () => {
  it("arma el POST correcto con Bearer, model y stream:true", () => {
    const { url, init } = buildChatRequest([{ role: "user", content: "hola" }], {
      apiKey: "or_test",
      chatModel: "modelo/x",
    });
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer or_test");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "modelo/x",
      messages: [{ role: "user", content: "hola" }],
      stream: true,
    });
  });

  it("sin chatModel -> usa DEFAULT_CHAT_MODEL", () => {
    const { init } = buildChatRequest([{ role: "user", content: "x" }], { apiKey: "k" });
    expect((JSON.parse(init.body as string) as { model: string }).model).toBe(DEFAULT_CHAT_MODEL);
  });
});

describe("openRouterAiClient.chatStream (fetch inyectado — jamas la API real)", () => {
  it("reconstruye un delta partido a mitad de línea y propaga el usage/costo real del chunk final", async () => {
    const client = openRouterAiClient({
      apiKey: "k",
      embeddingModel: "m",
      fetchImpl: async () => fakeChatSseResponse(),
    });
    const chunks = await collect(client.chatStream([{ role: "user", content: "hola" }]));
    expect(chunks).toEqual([
      { type: "delta", text: "Hola" },
      { type: "done", usage: { promptTokens: 12, completionTokens: 4, costUsd: 0.000007 } },
    ] satisfies ChatStreamChunk[]);
  });

  it("4xx -> yield único {type:error} (sin lanzar)", async () => {
    const client = openRouterAiClient({
      apiKey: "k",
      embeddingModel: "m",
      fetchImpl: async () => new Response("{}", { status: 429 }),
    });
    expect(await collect(client.chatStream([{ role: "user", content: "x" }]))).toEqual([
      { type: "error", error: "openrouter_http_429" },
    ]);
  });

  it("fallo de red -> yield {type:error, error:network_error} (sin lanzar)", async () => {
    const client = openRouterAiClient({
      apiKey: "k",
      embeddingModel: "m",
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      },
    });
    expect(await collect(client.chatStream([{ role: "user", content: "x" }]))).toEqual([
      { type: "error", error: "network_error" },
    ]);
  });

  // Hallazgo de revisión de correctness (2026-07-18, CONFIRMADO): el camino
  // feliz (el chunk final de `usage` sin `choices`) hacía `return` sin nunca
  // cancelar/liberar el `reader` del body — fuga de conexión sistemática, no
  // un edge case (ocurre en el 100% de las respuestas exitosas reales).
  it("camino feliz: cancela el reader al terminar (evita fugas de conexión)", async () => {
    let cancelCalled = false;
    const encoder = new TextEncoder();
    const usageLine = 'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1,"cost":0.000001}}\n\n';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(usageLine));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
      cancel() {
        cancelCalled = true;
      },
    });
    const client = openRouterAiClient({
      apiKey: "k",
      embeddingModel: "m",
      fetchImpl: async () => new Response(stream, { status: 200 }),
    });
    await collect(client.chatStream([{ role: "user", content: "hola" }]));
    expect(cancelCalled).toBe(true);
  });

  // El consumidor real (`tutor-chat-service.ts`) hace `break` apenas recibe
  // el chunk "done", lo que dispara `IteratorClose` (equivalente a llamar
  // `.return()` sobre el generador) en vez de dejarlo terminar solo — ambos
  // caminos deben liberar el reader por igual gracias al `finally`.
  it("si el consumidor rompe el loop a medio stream (antes de 'done'): igual cancela el reader (protocolo IteratorClose)", async () => {
    let cancelCalled = false;
    const encoder = new TextEncoder();
    const deltaLine = 'data: {"id":"gen-1","choices":[{"index":0,"delta":{"content":"Hola"},"finish_reason":null}]}\n\n';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(deltaLine));
        // Nunca se cierra ni manda "done" — el consumidor rompe antes.
      },
      cancel() {
        cancelCalled = true;
      },
    });
    const client = openRouterAiClient({
      apiKey: "k",
      embeddingModel: "m",
      fetchImpl: async () => new Response(stream, { status: 200 }),
    });
    const gen = client.chatStream([{ role: "user", content: "hola" }]);
    const first = await gen.next();
    expect(first.value).toEqual({ type: "delta", text: "Hola" });
    await gen.return(undefined); // mismo protocolo que el `break` de tutor-chat-service.ts
    expect(cancelCalled).toBe(true);
  });
});

describe("noopAiClient (sin proveedor)", () => {
  it("configured:false y nunca llama red", async () => {
    const client = noopAiClient();
    expect(client.configured).toBe(false);
    expect(await client.embed(["a"])).toEqual({ ok: false, error: "not_configured" });
  });

  it("chatStream: yield defensivo {type:error, error:not_configured}, sin tocar red", async () => {
    const client = noopAiClient();
    expect(await collect(client.chatStream([{ role: "user", content: "x" }]))).toEqual([
      { type: "error", error: "not_configured" },
    ]);
  });
});

describe("aiClientFromEnv (degrada elegante sin proveedor)", () => {
  it("sin OPENROUTER_API_KEY -> noop", () => {
    expect(aiClientFromEnv({}).configured).toBe(false);
  });

  it("con key -> cliente configurado, modelo default si no se especifica", () => {
    const client = aiClientFromEnv({ OPENROUTER_API_KEY: "or_x" });
    expect(client.configured).toBe(true);
    expect(client.embeddingModel).toBe(DEFAULT_EMBEDDING_MODEL);
    expect(client.chatModel).toBe(DEFAULT_CHAT_MODEL);
  });

  it("con key y modelo custom -> usa el modelo del env", () => {
    const client = aiClientFromEnv({ OPENROUTER_API_KEY: "or_x", OPENROUTER_EMBEDDING_MODEL: "otro/modelo" });
    expect(client.embeddingModel).toBe("otro/modelo");
  });

  it("con key y OPENROUTER_MODEL custom -> usa ese chatModel en vez del default", () => {
    const client = aiClientFromEnv({ OPENROUTER_API_KEY: "or_x", OPENROUTER_MODEL: "anthropic/otro-modelo" });
    expect(client.chatModel).toBe("anthropic/otro-modelo");
  });

  it("key en blanco -> noop (mismo criterio que RESEND_API_KEY)", () => {
    expect(aiClientFromEnv({ OPENROUTER_API_KEY: "   " }).configured).toBe(false);
  });
});
