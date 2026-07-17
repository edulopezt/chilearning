import { describe, expect, it } from "vitest";

import {
  EMPTY_WIZARD_STATE,
  WIZARD_STEPS,
  WIZARD_TEMPLATES,
  hydrateWizardState,
  parseWizardStep,
  validateForGeneration,
  type WizardState,
} from "./course-wizard";

const datosRaw = {
  name: "Prevención de riesgos",
  modality: "elearning",
  hours: "12",
  sence: "true",
  codSence: "1234567890",
};

function withDatos(state: WizardState, raw: Record<string, unknown> = datosRaw): WizardState {
  const r = parseWizardStep("datos", raw, state);
  if (!r.ok) throw new Error(`datos inválido: ${JSON.stringify(r.errors)}`);
  return r.state;
}

const threeModules = {
  modules: [
    { id: "m1", title: "Módulo 1", hours: 4 },
    { id: "m2", title: "Módulo 2", hours: 4 },
    { id: "m3", title: "Módulo 3", hours: 4 },
  ],
};

describe("WIZARD_STEPS", () => {
  it("respeta el orden del CHECK de la migración", () => {
    expect(WIZARD_STEPS).toEqual([
      "datos",
      "estructura",
      "aprendizajes",
      "contenido",
      "evaluaciones",
      "completitud",
      "revision",
    ]);
  });
});

describe("parseWizardStep — datos", () => {
  it("reusa parseCourseInput y fuerza status=draft", () => {
    const r = parseWizardStep("datos", { ...datosRaw, status: "published" }, EMPTY_WIZARD_STATE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.datos?.status).toBe("draft");
      expect(r.state.datos?.hours).toBe(12);
    }
  });

  it("propaga errores de campo de parseCourseInput", () => {
    const r = parseWizardStep("datos", { ...datosRaw, name: "" }, EMPTY_WIZARD_STATE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.name).toBeTruthy();
  });
});

describe("parseWizardStep — estructura", () => {
  it("exige al menos un módulo", () => {
    const r = parseWizardStep("estructura", { modules: [] }, EMPTY_WIZARD_STATE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.modules).toBeTruthy();
  });

  it("exige horas enteras positivas por módulo", () => {
    const r = parseWizardStep(
      "estructura",
      { modules: [{ title: "M1", hours: "0" }] },
      EMPTY_WIZARD_STATE,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["modules.0.hours"]).toBeTruthy();
  });

  it("curso NO sence: acepta módulos aunque la suma de horas no cuadre con datos.hours", () => {
    const state = withDatos(EMPTY_WIZARD_STATE, { ...datosRaw, sence: "false", codSence: "" });
    const r = parseWizardStep("estructura", { modules: [{ title: "M1", hours: "999" }] }, state);
    expect(r.ok).toBe(true);
  });

  it("curso SENCE: la suma de horas de los módulos debe igualar datos.hours", () => {
    const state = withDatos(EMPTY_WIZARD_STATE); // hours: 12
    const bad = parseWizardStep("estructura", { modules: [{ title: "M1", hours: "5" }] }, state);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.hours).toBeTruthy();

    const ok = parseWizardStep("estructura", { modules: threeModules.modules }, state);
    expect(ok.ok).toBe(true);
  });

  it("rechaza ids de módulo duplicados", () => {
    const r = parseWizardStep(
      "estructura",
      { modules: [{ id: "m1", title: "A", hours: "1" }, { id: "m1", title: "B", hours: "1" }] },
      EMPTY_WIZARD_STATE,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["modules.1.id"]).toBeTruthy();
  });
});

describe("parseWizardStep — contenido", () => {
  it("reusa parseLessonInput por lección y exige moduleId válido", () => {
    const state: WizardState = { ...EMPTY_WIZARD_STATE, estructura: threeModules };
    const bad = parseWizardStep(
      "contenido",
      { lessons: [{ moduleId: "no-existe", title: "L1", kind: "text", content: "hola" }] },
      state,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors["lessons.0.moduleId"]).toBeTruthy();

    const ok = parseWizardStep(
      "contenido",
      { lessons: [{ moduleId: "m1", title: "L1", kind: "text", content: "hola" }] },
      state,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.state.contenido.lessons).toHaveLength(1);
  });

  it("propaga errores del parser de lecciones (p.ej. video sin id/url válido)", () => {
    const state: WizardState = { ...EMPTY_WIZARD_STATE, estructura: threeModules };
    const r = parseWizardStep(
      "contenido",
      { lessons: [{ moduleId: "m1", title: "L1", kind: "video", content: "" }] },
      state,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["lessons.0.content"]).toBeTruthy();
  });
});

describe("parseWizardStep — evaluaciones", () => {
  it("curso NO sence: no exige evaluación por módulo ni encuesta", () => {
    const state = withDatos({ ...EMPTY_WIZARD_STATE, estructura: threeModules }, {
      ...datosRaw,
      sence: "false",
      codSence: "",
    });
    const r = parseWizardStep("evaluaciones", { quizzes: [], survey: { enabled: false } }, state);
    expect(r.ok).toBe(true);
  });

  it("curso SENCE: cada módulo de la estructura necesita ≥1 evaluación", () => {
    const state = withDatos({ ...EMPTY_WIZARD_STATE, estructura: threeModules });
    const r = parseWizardStep(
      "evaluaciones",
      {
        quizzes: [{ moduleId: "m1", title: "Eval 1" }],
        survey: { enabled: true, title: "Encuesta" },
      },
      state,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.evaluaciones).toContain("Módulo 2");
  });

  it("curso SENCE: exige encuesta habilitada aunque todos los módulos tengan evaluación", () => {
    const state = withDatos({ ...EMPTY_WIZARD_STATE, estructura: threeModules });
    const r = parseWizardStep(
      "evaluaciones",
      {
        quizzes: threeModules.modules.map((m) => ({ moduleId: m.id, title: `Eval ${m.id}` })),
        survey: { enabled: false },
      },
      state,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.evaluaciones).toContain("encuesta");
  });

  it("curso SENCE: pasa con evaluación por módulo + encuesta habilitada", () => {
    const state = withDatos({ ...EMPTY_WIZARD_STATE, estructura: threeModules });
    const r = parseWizardStep(
      "evaluaciones",
      {
        quizzes: threeModules.modules.map((m) => ({ moduleId: m.id, title: `Eval ${m.id}` })),
        survey: { enabled: true, title: "Encuesta de satisfacción" },
      },
      state,
    );
    expect(r.ok).toBe(true);
  });

  it("encuesta habilitada exige título", () => {
    const r = parseWizardStep(
      "evaluaciones",
      { quizzes: [], survey: { enabled: true, title: "" } },
      EMPTY_WIZARD_STATE,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["survey.title"]).toBeTruthy();
  });
});

describe("parseWizardStep — completitud", () => {
  it("nunca falla (normalizeCompletionRules siempre normaliza)", () => {
    const r = parseWizardStep("completitud", { requireSurvey: "on" }, EMPTY_WIZARD_STATE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.completitud).toEqual({ requireAllLessons: true, requireSurvey: true, minAttendancePct: 0 });
  });
});

describe("parseWizardStep — revision", () => {
  it("bloquea si el estado no pasa validateForGeneration", () => {
    const r = parseWizardStep("revision", {}, EMPTY_WIZARD_STATE);
    expect(r.ok).toBe(false);
  });

  it("pasa cuando el estado está completo", () => {
    let state = withDatos(EMPTY_WIZARD_STATE);
    state = { ...state, estructura: threeModules };
    state = { ...state, completitud: { requireAllLessons: true, requireSurvey: true, minAttendancePct: 75 } };
    state = {
      ...state,
      evaluaciones: {
        quizzes: threeModules.modules.map((m) => ({ moduleId: m.id, title: `Eval ${m.id}` })),
        survey: { enabled: true, title: "Encuesta" },
      },
    };
    const r = parseWizardStep("revision", {}, state);
    expect(r.ok).toBe(true);
  });
});

describe("validateForGeneration — casos borde", () => {
  it("estado vacío: bloquea por datos, estructura y completitud faltantes", () => {
    const r = validateForGeneration(EMPTY_WIZARD_STATE);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.blockers.some((b) => b.includes("datos"))).toBe(true);
      expect(r.blockers.some((b) => b.includes("módulo"))).toBe(true);
      expect(r.blockers.some((b) => b.includes("completitud"))).toBe(true);
    }
  });

  it("0 módulos: bloquea aunque el resto esté completo", () => {
    let state = withDatos(EMPTY_WIZARD_STATE);
    state = { ...state, completitud: { requireAllLessons: true, requireSurvey: false, minAttendancePct: 0 } };
    const r = validateForGeneration(state);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blockers.some((b) => b.includes("módulo"))).toBe(true);
  });

  it("horas que no cuadran (curso SENCE): bloquea con el detalle de la suma", () => {
    let state = withDatos(EMPTY_WIZARD_STATE); // hours: 12
    state = {
      ...state,
      estructura: { modules: [{ id: "m1", title: "M1", hours: 5 }] }, // suma 5 ≠ 12
      completitud: { requireAllLessons: true, requireSurvey: true, minAttendancePct: 0 },
      evaluaciones: { quizzes: [{ moduleId: "m1", title: "Eval" }], survey: { enabled: true, title: "Encuesta" } },
    };
    const r = validateForGeneration(state);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blockers.some((b) => b.includes("12"))).toBe(true);
  });

  it("módulo sin evaluación en curso SENCE: bloquea", () => {
    let state = withDatos(EMPTY_WIZARD_STATE);
    state = {
      ...state,
      estructura: threeModules,
      completitud: { requireAllLessons: true, requireSurvey: true, minAttendancePct: 0 },
      evaluaciones: {
        quizzes: [{ moduleId: "m1", title: "Eval 1" }, { moduleId: "m2", title: "Eval 2" }],
        survey: { enabled: true, title: "Encuesta" },
      },
    };
    const r = validateForGeneration(state);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blockers.some((b) => b.includes("Módulo 3"))).toBe(true);
  });
});

describe("validateForGeneration — referencias moduleId huérfanas tras reeditar 'estructura' (4-ojos MED)", () => {
  it("bloquea si aprendizajes/contenido/evaluaciones apuntan a un módulo que ya no existe en la estructura", () => {
    let state = withDatos(EMPTY_WIZARD_STATE, { ...datosRaw, hours: "4" });
    state = { ...state, estructura: { modules: [{ id: "m1", title: "M1", hours: 4 }] } };
    state = { ...state, aprendizajes: { m1: ["a"], m2: ["huérfano"] } };
    state = { ...state, contenido: { lessons: [{ moduleId: "m2", title: "L", kind: "text", content: "c" }] } };
    state = {
      ...state,
      evaluaciones: {
        quizzes: [
          { moduleId: "m1", title: "Eval 1" },
          { moduleId: "m2", title: "Eval huérfana" },
        ],
        survey: { enabled: true, title: "Encuesta" },
      },
    };
    state = { ...state, completitud: { requireAllLessons: true, requireSurvey: true, minAttendancePct: 0 } };

    const r = validateForGeneration(state);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.blockers.some((b) => b.includes("m2") && b.includes("lecciones"))).toBe(true);
      expect(r.blockers.some((b) => b.includes("m2") && b.includes("evaluaciones"))).toBe(true);
      expect(r.blockers.some((b) => b.includes("m2") && b.includes("aprendizajes"))).toBe(true);
    }
  });

  it("no bloquea por esto si todas las referencias moduleId siguen vigentes en la estructura actual", () => {
    let state = withDatos(EMPTY_WIZARD_STATE);
    state = { ...state, estructura: threeModules };
    state = { ...state, completitud: { requireAllLessons: true, requireSurvey: true, minAttendancePct: 75 } };
    state = {
      ...state,
      aprendizajes: { m1: ["a"], m2: ["b"], m3: ["c"] },
      contenido: { lessons: [{ moduleId: "m1", title: "L1", kind: "text", content: "x" }] },
      evaluaciones: {
        quizzes: threeModules.modules.map((m) => ({ moduleId: m.id, title: `Eval ${m.id}` })),
        survey: { enabled: true, title: "Encuesta" },
      },
    };
    const r = validateForGeneration(state);
    expect(r.ok).toBe(true);
  });
});

describe("WIZARD_TEMPLATES", () => {
  it("expone al menos las 2 plantillas requeridas", () => {
    expect(WIZARD_TEMPLATES.elearning_sence_estandar).toBeDefined();
    expect(WIZARD_TEMPLATES.elearning_libre).toBeDefined();
  });

  it("NO precargan datos.name (el usuario no debería tener que borrar texto genérico)", () => {
    for (const t of Object.values(WIZARD_TEMPLATES)) {
      expect(t.state.datos).toBeUndefined();
    }
  });

  it("elearning_sence_estandar pasa validateForGeneration tras completar SOLO 'datos' encima de la plantilla", () => {
    const seeded: WizardState = { ...EMPTY_WIZARD_STATE, ...WIZARD_TEMPLATES.elearning_sence_estandar!.state };
    const total = seeded.estructura.modules.reduce((acc, m) => acc + m.hours, 0);
    const state = withDatos(seeded, { ...datosRaw, hours: String(total) });
    const r = validateForGeneration(state);
    expect(r.ok).toBe(true);
  });

  it("elearning_libre pasa validateForGeneration tras completar SOLO 'datos' encima de la plantilla", () => {
    const seeded: WizardState = { ...EMPTY_WIZARD_STATE, ...WIZARD_TEMPLATES.elearning_libre!.state };
    const total = seeded.estructura.modules.reduce((acc, m) => acc + m.hours, 0);
    const state = withDatos(seeded, { ...datosRaw, sence: "false", codSence: "", hours: String(total) });
    const r = validateForGeneration(state);
    expect(r.ok).toBe(true);
  });
});

describe("hydrateWizardState", () => {
  it("rellena con defaults sobre un jsonb parcial/vacío", () => {
    expect(hydrateWizardState(null)).toEqual(EMPTY_WIZARD_STATE);
    expect(hydrateWizardState({})).toEqual(EMPTY_WIZARD_STATE);
    const partial = hydrateWizardState({ estructura: threeModules });
    expect(partial.estructura).toEqual(threeModules);
    expect(partial.datos).toBeNull();
  });
});
