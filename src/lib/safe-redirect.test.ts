import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath (anti open-redirect)", () => {
  it("acepta rutas internas absolutas", () => {
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/admin/cursos?x=1")).toBe("/admin/cursos?x=1");
  });

  it("rechaza protocol-relative (//host) y (/\\host)", () => {
    expect(safeRedirectPath("//evil.com")).toBe("/dashboard");
    expect(safeRedirectPath("/\\evil.com")).toBe("/dashboard");
  });

  it("rechaza URLs externas y esquemas", () => {
    expect(safeRedirectPath("https://evil.com")).toBe("/dashboard");
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/dashboard");
    expect(safeRedirectPath("dashboard")).toBe("/dashboard"); // relativa sin /
  });

  it("cae al fallback ante vacío/nulo", () => {
    expect(safeRedirectPath(null)).toBe("/dashboard");
    expect(safeRedirectPath("")).toBe("/dashboard");
    expect(safeRedirectPath(undefined, "/mi-curso")).toBe("/mi-curso");
  });
});
