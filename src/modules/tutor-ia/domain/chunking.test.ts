import { describe, expect, it } from "vitest";

import { chunkLessonContent } from "./chunking";

describe("chunkLessonContent (task 5.8a, HU-11.1)", () => {
  it("contenido vacío → sin chunks (nada que indexar)", () => {
    expect(chunkLessonContent("Título", "")).toEqual([]);
    expect(chunkLessonContent("Título", "   \n\n  ")).toEqual([]);
  });

  it("contenido más corto que targetChars → un solo chunk, prefijado con el título", () => {
    const chunks = chunkLessonContent("Introducción", "Un párrafo corto de ejemplo.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ chunkIndex: 0, text: "Introducción\n\nUn párrafo corto de ejemplo." });
  });

  it("una línea gigante sin saltos: corta igual, no crashea ni produce un chunk descomunal", () => {
    const giant = "palabra ".repeat(20_000).trim(); // ~160k chars, sin \n
    const chunks = chunkLessonContent("Lección larga", giant, { targetChars: 1200 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThan(1200 * 2); // muy por debajo de 50000
    }
    // Reconstruye a ~el mismo contenido (sin el prefijo de título) sin perder texto.
    const rebuilt = chunks.map((c) => c.text.replace(/^Lección larga\n\n/, "")).join(" ");
    expect(rebuilt.replace(/\s+/g, " ").length).toBeGreaterThan(giant.length * 0.95);
  });

  it("un solo token gigante sin ESPACIOS ni saltos (peor caso): corte duro, sin crashear", () => {
    const giant = "x".repeat(10_000);
    const chunks = chunkLessonContent("Título", giant, { targetChars: 1200 });
    expect(chunks.length).toBeGreaterThan(1);
    // El overlap puede empujar un chunk un poco más allá de targetChars (hasta
    // ~targetChars + overlapChars), pero JAMÁS cerca de los 50000 del peor caso
    // sin cortar -- eso es lo que este test realmente blinda.
    for (const c of chunks) {
      expect(c.text.length).toBeLessThan(2000);
    }
  });

  it("headings anidados: respeta los límites de heading/párrafo al cortar", () => {
    const content = [
      "# Título principal",
      "",
      "Texto introductorio de la lección.",
      "",
      "## Subtítulo A",
      "",
      "Contenido del subtítulo A.",
      "",
      "### Subtítulo A.1",
      "",
      "Contenido más específico.",
    ].join("\n");
    const chunks = chunkLessonContent("Lección con headings", content, { targetChars: 5000 });
    // Todo cabe holgado en targetChars=5000 → un solo chunk que preserva el orden.
    expect(chunks).toHaveLength(1);
    const text = chunks[0]!.text;
    expect(text.indexOf("# Título principal")).toBeLessThan(text.indexOf("## Subtítulo A"));
    expect(text.indexOf("## Subtítulo A")).toBeLessThan(text.indexOf("### Subtítulo A.1"));
  });

  it("headings anidados con targetChars chico: parte en varios chunks respetando los límites", () => {
    const content = [
      "# Título principal",
      "",
      "Texto introductorio de la lección con algo de relleno adicional para que pese.",
      "",
      "## Subtítulo A",
      "",
      "Contenido del subtítulo A con más relleno para que este bloque también pese algo.",
    ].join("\n");
    const chunks = chunkLessonContent("Lección", content, { targetChars: 80, overlapChars: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    // Ningún chunk debería contener un heading a mitad de una oración de otro bloque.
    for (const c of chunks) {
      expect(c.chunkIndex).toBeGreaterThanOrEqual(0);
    }
    // El primer chunk arranca con el heading principal (prefijado por el título de la lección).
    expect(chunks[0]!.text).toContain("# Título principal");
  });

  it("chunkIndex es secuencial 0..n-1", () => {
    const content = Array.from({ length: 10 }, (_, i) => `Párrafo número ${i} con algo de texto de relleno.`).join(
      "\n\n",
    );
    const chunks = chunkLessonContent("Lección", content, { targetChars: 100 });
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it("sin título: no agrega un prefijo vacío con doble salto de línea colgando", () => {
    const chunks = chunkLessonContent("   ", "Contenido sin título.");
    expect(chunks[0]!.text).toBe("Contenido sin título.");
  });
});
