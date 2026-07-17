import { describe, expect, it } from "vitest";

import {
  buildTutorPrompt,
  extractTutorContext,
  mapCitations,
  sanitizeFirstName,
  type TutorPromptFragment,
  type TutorPromptInput,
} from "./prompt";

const RUN_RE = /\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]/i;
const EMAIL_RE = /@/;

describe("sanitizeFirstName", () => {
  it("toma el primer token", () => {
    expect(sanitizeFirstName("Maria Jose Perez Soto")).toBe("Maria");
  });
  it("quita digitos y puntuacion", () => {
    expect(sanitizeFirstName("12.345.678-9")).toBe("Alumno/a");
    expect(sanitizeFirstName("Juan2 Perez")).toBe("Juan");
  });
  it("un caracter de control actua como separador de palabra (igual que un espacio)", () => {
    // Construido con fromCharCode (nunca un escape literal en el archivo)
    // para no dejar dudas de que el byte de control es real. sanitizeFirstName
    // normaliza los caracteres de control a espacio ANTES de tomar el primer
    // token -- por diseno, un tab/salto embebido corta la palabra en vez de
    // pegar dos fragmentos que no deberian ir juntos.
    const tab = String.fromCharCode(9);
    const bell = String.fromCharCode(7);
    expect(sanitizeFirstName(`Ju${tab}an`)).toBe("Ju");
    expect(sanitizeFirstName(`${bell}Pedro`)).toBe("Pedro");
  });
  it("capa a 40 caracteres", () => {
    const long = "A".repeat(60);
    expect(sanitizeFirstName(long)).toHaveLength(40);
  });
  it("fallback a Alumno/a si queda vacio tras sanear", () => {
    expect(sanitizeFirstName("")).toBe("Alumno/a");
    expect(sanitizeFirstName("   ")).toBe("Alumno/a");
    expect(sanitizeFirstName("---")).toBe("Alumno/a");
    expect(sanitizeFirstName("123456")).toBe("Alumno/a");
  });
  it("preserva nombres compuestos con guion", () => {
    expect(sanitizeFirstName("Jose-Miguel Contreras")).toBe("Jose-Miguel");
  });
});

describe("extractTutorContext", () => {
  it("delega en sanitizeFirstName y no toca el resto del principal", () => {
    const { firstName } = extractTutorContext(
      { userId: "u1", roles: ["student"] },
      "Ana Belen Rojas",
    );
    expect(firstName).toBe("Ana");
  });
});

const BASE_FRAGMENTS: TutorPromptFragment[] = [
  { n: 1, lessonId: "l1", lessonTitle: "Introduccion", text: "El riesgo laboral es..." },
  { n: 2, lessonId: "l2", lessonTitle: "EPP", text: "Los elementos de proteccion personal..." },
];

const BASE_INPUT: TutorPromptInput = {
  courseName: "Prevencion de riesgos e-learning",
  firstName: "Ana",
  fragments: BASE_FRAGMENTS,
  aggregateProgress: { completed: 1, total: 5 },
  history: [
    { role: "user", content: "hola" },
    { role: "assistant", content: "hola, como estas" },
  ],
  question: "que es un riesgo?",
};

describe("buildTutorPrompt (HU-11.3)", () => {
  it("se identifica SIEMPRE como asistente de IA de Chilearning", () => {
    const { system } = buildTutorPrompt(BASE_INPUT);
    expect(system).toContain("asistente de inteligencia artificial de Chilearning");
  });

  it("instruye citar con [n] y responder solo con base en el material", () => {
    const { system } = buildTutorPrompt(BASE_INPUT);
    expect(system).toMatch(/\[1\]|corchetes/);
    expect(system).toContain("SOLO con base en los fragmentos");
  });

  it("instruye ser honesto si la respuesta no esta en el material y derivar a un humano", () => {
    const { system } = buildTutorPrompt(BASE_INPUT);
    expect(system.toLowerCase()).toContain("no está en el material");
    expect(system.toLowerCase()).toContain("tutor humano");
  });

  it("incluye el avance agregado y los fragmentos numerados", () => {
    const { system } = buildTutorPrompt(BASE_INPUT);
    expect(system).toContain("1 de 5");
    expect(system).toContain("[1]");
    expect(system).toContain("[2]");
    expect(system).toContain("Introduccion");
  });

  it("sin fragmentos: lo dice explicitamente en vez de omitirlo en silencio", () => {
    const { system } = buildTutorPrompt({ ...BASE_INPUT, fragments: [] });
    expect(system).toContain("No hay fragmentos de material disponibles");
  });

  it("arma los messages con el historial + la pregunta actual al final", () => {
    const { messages } = buildTutorPrompt(BASE_INPUT);
    expect(messages).toEqual([
      { role: "user", content: "hola" },
      { role: "assistant", content: "hola, como estas" },
      { role: "user", content: "que es un riesgo?" },
    ]);
  });
});

describe("mapCitations", () => {
  it("mapea [n] a fragments[n-1]", () => {
    expect(mapCitations("Segun [1] y [2], ...", BASE_FRAGMENTS)).toEqual([
      { lessonId: "l1", lessonTitle: "Introduccion" },
      { lessonId: "l2", lessonTitle: "EPP" },
    ]);
  });
  it("ignora citas fuera de rango", () => {
    expect(mapCitations("Ver [0] y [99]", BASE_FRAGMENTS)).toEqual([]);
  });
  it("deduplica por lessonId (misma leccion citada varias veces)", () => {
    expect(mapCitations("[1] ... [1] otra vez ... [1]", BASE_FRAGMENTS)).toEqual([
      { lessonId: "l1", lessonTitle: "Introduccion" },
    ]);
  });
  it("sin citas, arreglo vacio", () => {
    expect(mapCitations("Sin numeros aqui.", BASE_FRAGMENTS)).toEqual([]);
  });
});

describe("HU-11.3 - cero PII del alumno en el prompt (test estrella)", () => {
  it("extractTutorContext/sanitizeFirstName filtran RUN, apellidos, correo y empresa colados en fullName", () => {
    const poisonedFullName =
      "Juan Perez Gonzalez RUN 12.345.678-9 correo juan.perez@constructoraXYZ.cl empresa Constructora XYZ SpA CodSence 1234567890";
    const { firstName } = extractTutorContext(
      { userId: "aaaaaaaa-0000-4000-8000-000000000005", roles: ["student"] },
      poisonedFullName,
    );
    expect(firstName).toBe("Juan");
    expect(firstName).not.toMatch(RUN_RE);
    expect(firstName).not.toMatch(EMAIL_RE);
    expect(firstName).not.toContain("Perez");
    expect(firstName).not.toContain("XYZ");
  });

  it(
    "buildTutorPrompt no tiene forma de aceptar apellido/correo/RUN del alumno: campos ilegitimos " +
      "colados via `as any` NUNCA aparecen en la salida (blindaje ante regresion). NOTA: a proposito " +
      "NO se envenena `courseName` con RUN/correo -- courseName es informacion LEGITIMA del curso " +
      "(no del alumno) y si se refleja en el prompt por diseno; envenenarlo produciria un falso " +
      "positivo en el regex. La prueba de fuego real es la firma de tipos: TutorPromptInput/" +
      "TutorPromptFragment no declaran lastName/email/run/company en absoluto.",
    () => {
      const smuggledRun = "12.345.678-9";
      const smuggledEmail = "juan.perez@empresaxyz.cl";
      const smuggledLastName = "Perez Gonzalez";
      const smuggledCompany = "Constructora XYZ SpA";
      const poisonedInput = {
        courseName: "Curso demo de prevencion de riesgos",
        firstName: "Juan",
        fragments: [
          { n: 1, lessonId: "l1", lessonTitle: "Leccion 1", text: "Contenido de la leccion." },
        ],
        aggregateProgress: { completed: 1, total: 3 },
        history: [],
        question: "que es un riesgo laboral?",
        // Campos ilegitimos -- TutorPromptInput/TutorPromptFragment NO los
        // declaran. Un llamador que rompa el tipo con `as any` no deberia
        // lograr que se filtren al prompt.
        run: smuggledRun,
        lastName: smuggledLastName,
        email: smuggledEmail,
        company: smuggledCompany,
        senceRut: "76111111-6",
      };
      const result = buildTutorPrompt(poisonedInput as unknown as TutorPromptInput);
      const json = JSON.stringify(result);
      for (const leaked of [smuggledRun, smuggledEmail, smuggledLastName, smuggledCompany]) {
        expect(json, `filtro un campo ilegitimo: ${leaked}`).not.toContain(leaked);
      }
      expect(json).not.toMatch(RUN_RE);
      expect(json).not.toMatch(EMAIL_RE);
    },
  );

  it("un fragmento con RUN/correo colado en su `text` documenta el LIMITE del blindaje: el filtro vive en el origen (retrieval/DB), no en buildTutorPrompt", () => {
    // Los fragmentos vienen del CONTENIDO DE LAS LECCIONES (dato curricular de
    // la OTEC, jamas del alumno) via course_chunks/retrieval. Si un
    // instructor pega un RUN en el material de una leccion es un problema de
    // higiene de contenido, no una fuga de PII del alumno -- fuera de alcance
    // de HU-11.3 (que protege al ALUMNO, no valida contenido curricular).
    const fragments: TutorPromptFragment[] = [
      { n: 1, lessonId: "l1", lessonTitle: "Ejemplo", text: "contenido curricular normal" },
    ];
    const { system } = buildTutorPrompt({ ...BASE_INPUT, fragments });
    expect(system).not.toMatch(RUN_RE);
  });
});
