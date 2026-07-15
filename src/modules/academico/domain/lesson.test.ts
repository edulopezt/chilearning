import { describe, expect, it } from "vitest";

import { parseLessonInput } from "./lesson";

const base = { title: "Intro", kind: "text", content: "Contenido de la lección", status: "draft" };

describe("parseLessonInput", () => {
  it("acepta una lección de texto válida", () => {
    expect(parseLessonInput(base).ok).toBe(true);
  });

  it("exige título", () => {
    const r = parseLessonInput({ ...base, title: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.field).toBe("title");
  });

  it("texto vacío es inválido", () => {
    expect(parseLessonInput({ ...base, content: "" }).ok).toBe(false);
  });

  it("video acepta un ID (Bunny) o una URL https", () => {
    expect(parseLessonInput({ ...base, kind: "video", content: "dQw4w9WgXcQ" }).ok).toBe(true);
    expect(parseLessonInput({ ...base, kind: "video", content: "https://vz-x.b-cdn.net/abc/play.m3u8" }).ok).toBe(true);
    expect(parseLessonInput({ ...base, kind: "video", content: "no válido!!" }).ok).toBe(false);
  });

  it("file y embed exigen URL https", () => {
    expect(parseLessonInput({ ...base, kind: "file", content: "https://cdn.cl/guia.pdf" }).ok).toBe(true);
    expect(parseLessonInput({ ...base, kind: "embed", content: "http://inseguro.cl" }).ok).toBe(false);
    expect(parseLessonInput({ ...base, kind: "file", content: "guia.pdf" }).ok).toBe(false);
  });

  it("rechaza tipo y estado inválidos", () => {
    expect(parseLessonInput({ ...base, kind: "audio" }).ok).toBe(false);
    expect(parseLessonInput({ ...base, status: "live" }).ok).toBe(false);
  });
});
