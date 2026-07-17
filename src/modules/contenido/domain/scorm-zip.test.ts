import { describe, expect, it } from "vitest";

import {
  contentTypeFor,
  exceedsUncompressedBudget,
  MAX_UNCOMPRESSED_BYTES,
  MAX_ZIP_FILES,
  sanitizeScormPath,
  validateZipEntries,
} from "./scorm-zip";

describe("validateZipEntries (task 5.1a)", () => {
  it("acepta rutas normales", () => {
    expect(validateZipEntries(["imsmanifest.xml", "index.html", "assets/img/a.png"])).toEqual({ ok: true });
  });

  it("rechaza traversal (..)", () => {
    expect(validateZipEntries(["../evil.js"])).toEqual({ ok: false, error: "unsafe_path" });
    expect(validateZipEntries(["assets/../../evil.js"])).toEqual({ ok: false, error: "unsafe_path" });
  });

  it("rechaza rutas absolutas (unix y windows)", () => {
    expect(validateZipEntries(["/etc/passwd"])).toEqual({ ok: false, error: "unsafe_path" });
    expect(validateZipEntries(["C:\\Windows\\system32"])).toEqual({ ok: false, error: "unsafe_path" });
  });

  it("rechaza backslash", () => {
    expect(validateZipEntries(["assets\\img.png"])).toEqual({ ok: false, error: "unsafe_path" });
  });

  it("rechaza más de MAX_ZIP_FILES archivos", () => {
    const many = Array.from({ length: MAX_ZIP_FILES + 1 }, (_, i) => `f${i}.txt`);
    expect(validateZipEntries(many)).toEqual({ ok: false, error: "too_many_files" });
  });

  it("el límite exacto SÍ pasa", () => {
    const exact = Array.from({ length: MAX_ZIP_FILES }, (_, i) => `f${i}.txt`);
    expect(validateZipEntries(exact)).toEqual({ ok: true });
  });
});

describe("exceedsUncompressedBudget (guardia anti zip-bomb)", () => {
  it("bajo el límite: no excede", () => {
    expect(exceedsUncompressedBudget(MAX_UNCOMPRESSED_BYTES - 1)).toBe(false);
  });

  it("en el límite exacto: no excede", () => {
    expect(exceedsUncompressedBudget(MAX_UNCOMPRESSED_BYTES)).toBe(false);
  });

  it("sobre el límite: excede", () => {
    expect(exceedsUncompressedBudget(MAX_UNCOMPRESSED_BYTES + 1)).toBe(true);
  });
});

describe("contentTypeFor", () => {
  it("mapea extensiones conocidas", () => {
    expect(contentTypeFor("index.html")).toBe("text/html");
    expect(contentTypeFor("app.js")).toBe("text/javascript");
    expect(contentTypeFor("style.css")).toBe("text/css");
    expect(contentTypeFor("img/a.PNG")).toBe("image/png");
    expect(contentTypeFor("clip.mp4")).toBe("video/mp4");
    expect(contentTypeFor("font.woff2")).toBe("font/woff2");
    expect(contentTypeFor("data.json")).toBe("application/json");
  });

  it("sin extensión conocida (o sin extensión) → application/octet-stream", () => {
    expect(contentTypeFor("archivo.raro")).toBe("application/octet-stream");
    expect(contentTypeFor("sinextension")).toBe("application/octet-stream");
  });
});

describe("sanitizeScormPath", () => {
  it("acepta rutas normales", () => {
    expect(sanitizeScormPath("assets/img/a.png")).toEqual({ ok: true, value: "assets/img/a.png" });
  });

  it("colapsa './' (normaliza)", () => {
    expect(sanitizeScormPath("./assets/./img/a.png")).toEqual({ ok: true, value: "assets/img/a.png" });
  });

  it("rechaza '..' incluso tras normalizar", () => {
    expect(sanitizeScormPath("assets/../../evil.js").ok).toBe(false);
    expect(sanitizeScormPath("./../evil.js").ok).toBe(false);
  });

  it("rechaza '//'", () => {
    expect(sanitizeScormPath("assets//img.png").ok).toBe(false);
  });

  it("rechaza caracteres de control (incluye \\0)", () => {
    expect(sanitizeScormPath("assets/img\0.png").ok).toBe(false);
    expect(sanitizeScormPath("assets/\x01img.png").ok).toBe(false);
  });

  it("rechaza rutas absolutas y backslash", () => {
    expect(sanitizeScormPath("/etc/passwd").ok).toBe(false);
    expect(sanitizeScormPath("C:\\evil").ok).toBe(false);
    expect(sanitizeScormPath("assets\\img.png").ok).toBe(false);
  });

  it("rechaza longitud excesiva", () => {
    expect(sanitizeScormPath("a".repeat(1025)).ok).toBe(false);
    expect(sanitizeScormPath(`${"a".repeat(1020)}.png`).ok).toBe(true);
  });

  it("rechaza vacío", () => {
    expect(sanitizeScormPath("").ok).toBe(false);
  });
});
