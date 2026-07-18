import { describe, expect, it } from "vitest";

import { buildDraftPrompt, type DraftPromptFragment, type DraftPromptInput } from "./draft-prompt";
import { stripPIIForDraft } from "./pii-strip";

const BASE_FRAGMENTS: DraftPromptFragment[] = [
  { n: 1, lessonId: "l1", lessonTitle: "Introducción", text: "El riesgo laboral es..." },
  { n: 2, lessonId: "l2", lessonTitle: "EPP", text: "Los elementos de protección personal..." },
];

const BASE_INPUT: DraftPromptInput = {
  question: "¿qué elementos de protección debo usar?",
  fragments: BASE_FRAGMENTS,
};

describe("buildDraftPrompt (HU-9.5)", () => {
  it("se identifica como un asistente que ayuda a un tutor/relator a redactar un borrador", () => {
    const { system } = buildDraftPrompt(BASE_INPUT);
    expect(system.toLowerCase()).toContain("tutor o relator");
    expect(system.toLowerCase()).toContain("borrador");
  });

  it("instruye citar con [n] y responder solo con base en los fragmentos", () => {
    const { system } = buildDraftPrompt(BASE_INPUT);
    expect(system).toMatch(/\[1\]|corchetes/);
    expect(system).toContain("SOLO con base en los fragmentos");
  });

  it("instruye ser honesto si los fragmentos no alcanzan y sugerir derivar a un humano", () => {
    const { system } = buildDraftPrompt(BASE_INPUT);
    expect(system.toLowerCase()).toContain("no alcanzan");
    expect(system.toLowerCase()).toContain("tutor humano");
  });

  it("deja explícito que el resultado es SOLO UN BORRADOR que el relator revisa antes de enviar", () => {
    const { system } = buildDraftPrompt(BASE_INPUT);
    expect(system).toContain("SOLO UN BORRADOR");
    expect(system.toLowerCase()).toContain("nunca se envía solo");
  });

  it("incluye los fragmentos numerados", () => {
    const { system } = buildDraftPrompt(BASE_INPUT);
    expect(system).toContain("[1]");
    expect(system).toContain("[2]");
    expect(system).toContain("Introducción");
  });

  it("sin fragmentos: lo dice explícitamente en vez de omitirlo en silencio (curso sin contenido indexado)", () => {
    const { system } = buildDraftPrompt({ ...BASE_INPUT, fragments: [] });
    expect(system).toContain("No hay fragmentos de material disponibles");
  });

  it("arma un único mensaje user con la pregunta", () => {
    const { messages } = buildDraftPrompt(BASE_INPUT);
    expect(messages).toEqual([{ role: "user", content: BASE_INPUT.question }]);
  });
});

describe("HU-9.5 — cero PII del alumno en el prompt del borrador (test estrella)", () => {
  it(
    "una pregunta envenenada con RUN/correo/telefono/apellido, saneada por stripPIIForDraft y luego " +
      "pasada a buildDraftPrompt, no deja ningún patrón reconocible de RUN/correo/telefono en el prompt serializado",
    () => {
      const poisonedQuestion =
        "Hola, soy Juan Perez Gonzalez, mi run es 12.345.678-9, mi correo juan.perez@constructoraXYZ.cl " +
        "y mi telefono +56 9 1234 5678. Tengo una duda sobre la lección 2 de EPP.";
      const sanitized = stripPIIForDraft(poisonedQuestion);
      const result = buildDraftPrompt({ question: sanitized, fragments: BASE_FRAGMENTS });
      const json = JSON.stringify(result);

      const RUN_RE = /\d{1,2}[.\s]?\d{3}[.\s]?\d{3}[-\s]?[0-9kK]/;
      const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
      const PHONE_RE = /(\+?56[\s-]?)?9[\s-]?\d{4}[\s-]?\d{4}/;

      expect(json).not.toMatch(RUN_RE);
      expect(json).not.toMatch(EMAIL_RE);
      expect(json).not.toMatch(PHONE_RE);
      expect(json).not.toContain("12.345.678-9");
      expect(json).not.toContain("juan.perez@constructoraXYZ.cl");
      // El resto de la pregunta (legítimo) SÍ sobrevive: no es un `using(false)` global.
      expect(json).toContain("EPP");
    },
  );

  it(
    "buildDraftPrompt no tiene forma de aceptar nombre/RUN/correo/empresa del alumno: campos ilegítimos " +
      "colados vía `as any` NUNCA aparecen en la salida (blindaje ante regresión, misma prueba que prompt.test.ts)",
    () => {
      const smuggledRun = "12.345.678-9";
      const smuggledEmail = "juan.perez@empresaxyz.cl";
      const smuggledName = "Juan Perez Gonzalez";
      const smuggledCompany = "Constructora XYZ SpA";
      const poisonedInput = {
        question: "¿qué debo hacer con el material del módulo 2?",
        fragments: BASE_FRAGMENTS,
        // Campos ilegítimos: DraftPromptInput no los declara.
        studentName: smuggledName,
        run: smuggledRun,
        email: smuggledEmail,
        company: smuggledCompany,
      };
      const result = buildDraftPrompt(poisonedInput as unknown as DraftPromptInput);
      const json = JSON.stringify(result);
      for (const leaked of [smuggledRun, smuggledEmail, smuggledName, smuggledCompany]) {
        expect(json, `filtró un campo ilegítimo: ${leaked}`).not.toContain(leaked);
      }
    },
  );
});
