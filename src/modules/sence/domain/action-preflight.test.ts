import { describe, expect, it } from "vitest";

import {
  evaluateActionPreflight,
  type ActionPreflightInput,
  type ChecklistItemId,
} from "./action-preflight";

/** Fixture base 100% válido; cada test rompe UNA cosa. */
function baseInput(): ActionPreflightInput {
  return {
    action: {
      codigoAccion: "RLAB-19-02-08-0071",
      trainingLine: 3,
      environment: "rce",
      startsOn: "2026-08-01",
      endsOn: "2026-08-31",
    },
    course: { codSence: "1237999888" },
    config: { rutOtec: "76111111-6", hasToken: true, tokenOk: true },
    enrollments: [
      { enrollmentId: "e1", run: "5126663-3", exento: false },
      { enrollmentId: "e2", run: "16032460-0", exento: false },
    ],
    todayIsoDate: "2026-07-15",
    guideSentAt: "2026-07-14T10:00:00Z",
  };
}

function item(result: ReturnType<typeof evaluateActionPreflight>, id: ChecklistItemId) {
  const found = result.items.find((i) => i.id === id);
  if (!found) throw new Error(`falta el ítem ${id}`);
  return found;
}

describe("evaluateActionPreflight — fixture válido", () => {
  it("todo ok (overall ok) con el fixture base", () => {
    const r = evaluateActionPreflight(baseInput());
    expect(r.overall).toBe("ok");
    expect(r.invalidRuns).toEqual([]);
    for (const i of r.items) expect(i.status).toBe("ok");
  });
});

describe("evaluateActionPreflight — RUN inválidos plantados (GATE del hito)", () => {
  it("detecta DV incorrecto, vacío, basura y cuerpo largo; los puntos se normalizan", () => {
    const input: ActionPreflightInput = {
      ...baseInput(),
      enrollments: [
        { enrollmentId: "ok", run: "5126663-3", exento: false },
        { enrollmentId: "dv", run: "12345678-9", exento: false }, // DV correcto es 5
        // Con puntos pero DV correcto: normaliza (como el import CSV) → VÁLIDO.
        { enrollmentId: "dots-ok", run: "12.345.678-5", exento: false },
        { enrollmentId: "dots-dv", run: "12.345.678-9", exento: false }, // normaliza y el DV sigue malo
        { enrollmentId: "empty", run: "", exento: false },
        { enrollmentId: "junk", run: "no-es-run", exento: false },
        { enrollmentId: "long", run: "123456789-1", exento: false },
      ],
    };
    const r = evaluateActionPreflight(input);
    expect(item(r, "runs").status).toBe("error");
    expect(r.overall).toBe("error");
    const byId = new Map(r.invalidRuns.map((x) => [x.enrollmentId, x.rule]));
    expect(byId.get("dv")).toBe("run_dv");
    expect(byId.has("dots-ok")).toBe(false); // normalizado → válido
    expect(byId.get("dots-dv")).toBe("run_dv");
    expect(byId.get("empty")).toBe("required");
    expect(byId.get("junk")).toBe("run_format");
    expect(byId.get("long")).toBe("run_format");
    expect(byId.has("ok")).toBe(false);
  });

  it("una K mayúscula digitada se NORMALIZA antes de validar (como el import CSV)", () => {
    const input: ActionPreflightInput = {
      ...baseInput(),
      // 1000005-k: DV real es 'k' (módulo 11); el coordinador la digitó mayúscula.
      enrollments: [{ enrollmentId: "k", run: "1000005-K", exento: false }],
    };
    const r = evaluateActionPreflight(input);
    expect(r.invalidRuns).toEqual([]);
    expect(item(r, "runs").status).toBe("ok");
  });

  it("RUN inválido en EXENTO es warning, no error (no viaja a SENCE, I-14)", () => {
    const input: ActionPreflightInput = {
      ...baseInput(),
      enrollments: [
        { enrollmentId: "e1", run: "5126663-3", exento: false },
        { enrollmentId: "ex", run: "not-a-run", exento: true },
      ],
    };
    const r = evaluateActionPreflight(input);
    expect(item(r, "runs").status).toBe("warning");
    expect(r.overall).toBe("warning");
    expect(r.invalidRuns).toHaveLength(1);
    expect(r.invalidRuns[0]?.exento).toBe(true);
  });

  it("sin inscritos → warning (no bloquea, pero avisa)", () => {
    const r = evaluateActionPreflight({ ...baseInput(), enrollments: [] });
    expect(item(r, "runs").status).toBe("warning");
  });
});

describe("evaluateActionPreflight — configuración y códigos", () => {
  it("sin config SENCE → error en token y rut", () => {
    const r = evaluateActionPreflight({ ...baseInput(), config: null });
    expect(item(r, "config_token").status).toBe("error");
    expect(item(r, "config_rut_otec").status).toBe("error");
  });

  it("token presente pero ilegible/largo → error tokenInvalid", () => {
    const r = evaluateActionPreflight({
      ...baseInput(),
      config: { rutOtec: "76111111-6", hasToken: true, tokenOk: false },
    });
    const i = item(r, "config_token");
    expect(i.status).toBe("error");
    expect(i.detailKey).toBe("tokenInvalid");
  });

  it("línea 1 con CodSence presente → error must_be_empty", () => {
    const r = evaluateActionPreflight({
      ...baseInput(),
      action: { ...baseInput().action, trainingLine: 1 },
    });
    const i = item(r, "sence_course_code");
    expect(i.status).toBe("error");
    expect(i.detailKey).toBe("codSenceMustBeEmpty");
  });

  it("comodín -1 en producción (rce) → error; en rcetest → ok con warning de ambiente", () => {
    const wildcardProd = evaluateActionPreflight({
      ...baseInput(),
      course: { codSence: "-1" },
      action: { ...baseInput().action, codigoAccion: "-1" },
    });
    expect(item(wildcardProd, "sence_course_code").status).toBe("error");
    expect(item(wildcardProd, "action_code").status).toBe("error");

    const wildcardTest = evaluateActionPreflight({
      ...baseInput(),
      course: { codSence: "-1" },
      action: { ...baseInput().action, codigoAccion: "-1", environment: "rcetest" },
    });
    expect(item(wildcardTest, "sence_course_code").status).toBe("ok");
    expect(item(wildcardTest, "action_code").status).toBe("ok");
    expect(item(wildcardTest, "environment").status).toBe("warning");
    expect(wildcardTest.overall).toBe("warning");
  });
});

describe("evaluateActionPreflight — fechas y guía", () => {
  it("fechas faltantes → error; invertidas → error; ya iniciada → warning", () => {
    const base = baseInput();
    const missing = evaluateActionPreflight({
      ...base,
      action: { ...base.action, startsOn: null, endsOn: null },
    });
    expect(item(missing, "dates").status).toBe("error");

    const inverted = evaluateActionPreflight({
      ...base,
      action: { ...base.action, startsOn: "2026-09-01", endsOn: "2026-08-01" },
    });
    expect(item(inverted, "dates").status).toBe("error");

    const started = evaluateActionPreflight({
      ...base,
      action: { ...base.action, startsOn: "2026-07-01", endsOn: "2026-08-31" },
    });
    expect(item(started, "dates").status).toBe("warning");
  });

  it("guía no enviada → warning; enviada → ok", () => {
    const notSent = evaluateActionPreflight({ ...baseInput(), guideSentAt: null });
    expect(item(notSent, "clave_unica_guide").status).toBe("warning");
    const sent = evaluateActionPreflight(baseInput());
    expect(item(sent, "clave_unica_guide").status).toBe("ok");
  });
});
