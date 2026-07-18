import { describe, expect, it } from "vitest";

import { buildDigestNarrativePrompt, weekStartOf, type DigestNarrativeInput } from "./weekly-digest";

const BASE_INPUT: DigestNarrativeInput = {
  workers: 12,
  actions: 2,
  lessonsCompletedInPeriod: 34,
  attendanceDaysInPeriod: 40,
  gradesPublishedInPeriod: 3,
  certificatesIssuedInPeriod: 1,
};

describe("buildDigestNarrativePrompt (HU-8.2)", () => {
  it("incluye los 6 conteos en el system prompt", () => {
    const { system } = buildDigestNarrativePrompt(BASE_INPUT);
    expect(system).toContain("12");
    expect(system).toContain("Acciones de capacitación en curso: 2");
    expect(system).toContain("Lecciones completadas esta semana: 34");
    expect(system).toContain("Días con asistencia registrada esta semana: 40");
    expect(system).toContain("Notas publicadas esta semana: 3");
    expect(system).toContain("Certificados emitidos esta semana: 1");
  });

  it("pide lenguaje ejecutivo (avance, riesgos, hitos) en español de Chile", () => {
    const { system } = buildDigestNarrativePrompt(BASE_INPUT);
    expect(system.toLowerCase()).toContain("avance");
    expect(system.toLowerCase()).toContain("riesgo");
    expect(system.toLowerCase()).toContain("hito");
    expect(system.toLowerCase()).toContain("español de chile");
  });

  it("arma un mensaje user pidiendo la redacción", () => {
    const { messages } = buildDigestNarrativePrompt(BASE_INPUT);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
  });
});

describe("HU-8.2 — razonSocial/companyId NUNCA llegan al prompt (test estrella)", () => {
  it("DigestNarrativeInput no tiene forma de aceptar razonSocial/companyId: campos ilegítimos colados vía `as any` no aparecen en la salida", () => {
    const smuggledCompanyId = "c1000000-0000-4000-8000-000000000001";
    const smuggledRazonSocial = "Constructora XYZ SpA";
    const poisonedInput = {
      ...BASE_INPUT,
      // Campos ilegítimos: DigestNarrativeInput no los declara.
      companyId: smuggledCompanyId,
      razonSocial: smuggledRazonSocial,
    };
    const result = buildDigestNarrativePrompt(poisonedInput as unknown as DigestNarrativeInput);
    const json = JSON.stringify(result);
    expect(json, "filtró companyId").not.toContain(smuggledCompanyId);
    expect(json, "filtró razonSocial").not.toContain(smuggledRazonSocial);
  });
});

describe("weekStartOf (America/Santiago)", () => {
  // 2026-07-13 es LUNES (mismo ancla que cumplimiento.test.ts). Horas a media
  // mañana UTC para no rozar el borde del día en Santiago (UTC-3/-4).
  it("un lunes -> se devuelve a sí mismo", () => {
    expect(weekStartOf("2026-07-13T15:00:00.000Z")).toBe("2026-07-13");
  });

  it("un viernes de esa semana -> el lunes de esa semana", () => {
    expect(weekStartOf("2026-07-17T15:00:00.000Z")).toBe("2026-07-13");
  });

  it("un domingo -> el lunes de ESA semana (no el siguiente)", () => {
    expect(weekStartOf("2026-07-19T15:00:00.000Z")).toBe("2026-07-13");
  });

  it("el lunes siguiente -> avanza a la semana nueva", () => {
    expect(weekStartOf("2026-07-20T15:00:00.000Z")).toBe("2026-07-20");
  });
});
