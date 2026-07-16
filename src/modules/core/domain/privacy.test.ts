import { describe, expect, it } from "vitest";

import { classifyForErasure, parseDsrInput, PROCESSING_ACTIVITIES, RETENTION_POLICIES } from "./privacy";

describe("classifyForErasure", () => {
  it("conserva SENCE/certificados/notas/auditoría; suprime perfil/comunicación", () => {
    const c = classifyForErasure();
    const retainedTypes = c.retained.map((r) => r.dataType).join(" | ");
    expect(retainedTypes).toContain("Asistencia SENCE");
    expect(retainedTypes).toContain("Certificados");
    expect(retainedTypes).toContain("auditoría");
    expect(c.erasable.join(" | ")).toContain("perfil");
    // Cada retenido lleva un motivo (se informa como tal).
    expect(c.retained.every((r) => r.reason.length > 0)).toBe(true);
  });
});

describe("catálogos", () => {
  it("hay políticas de retención y registro de tratamientos", () => {
    expect(RETENTION_POLICIES.length).toBeGreaterThanOrEqual(5);
    expect(PROCESSING_ACTIVITIES.length).toBeGreaterThanOrEqual(3);
  });
});

describe("parseDsrInput", () => {
  it("acepta un tipo válido y rechaza uno inválido", () => {
    expect(parseDsrInput({ kind: "erasure", detail: "por favor" }).ok).toBe(true);
    expect(parseDsrInput({ kind: "invalido" }).ok).toBe(false);
  });
});
