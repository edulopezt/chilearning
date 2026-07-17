import { describe, expect, it } from "vitest";

import {
  aiClientFromEnv,
  buildEmbeddingsRequest,
  DEFAULT_EMBEDDING_MODEL,
  noopAiClient,
  openRouterAiClient,
} from "./ai-client";

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

describe("noopAiClient (sin proveedor)", () => {
  it("configured:false y nunca llama red", async () => {
    const client = noopAiClient();
    expect(client.configured).toBe(false);
    expect(await client.embed(["a"])).toEqual({ ok: false, error: "not_configured" });
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
  });

  it("con key y modelo custom -> usa el modelo del env", () => {
    const client = aiClientFromEnv({ OPENROUTER_API_KEY: "or_x", OPENROUTER_EMBEDDING_MODEL: "otro/modelo" });
    expect(client.embeddingModel).toBe("otro/modelo");
  });

  it("key en blanco -> noop (mismo criterio que RESEND_API_KEY)", () => {
    expect(aiClientFromEnv({ OPENROUTER_API_KEY: "   " }).configured).toBe(false);
  });
});
