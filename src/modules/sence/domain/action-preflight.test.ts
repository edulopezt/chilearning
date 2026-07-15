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
  it("valida el RUN CRUDO (espejo exacto del motor): DV malo, vacío, basura, largo, puntos", () => {
    const input: ActionPreflightInput = {
      ...baseInput(),
      enrollments: [
        { enrollmentId: "ok", run: "5126663-3", exento: false },
        { enrollmentId: "dv", run: "12345678-9", exento: false }, // DV correcto es 5
        // ⚠ R-1 del 4-ojos: el motor valida el valor ALMACENADO tal cual; un
        // RUN con puntos en la BD haría fallar CADA startSession, así que el
        // checklist DEBE marcarlo aunque su DV "normalizado" fuese correcto.
        { enrollmentId: "dots", run: "12.345.678-5", exento: false },
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
    expect(byId.get("dots")).toBe("run_format"); // el motor la rechazaría igual
    expect(byId.get("empty")).toBe("required");
    expect(byId.get("junk")).toBe("run_format");
    expect(byId.get("long")).toBe("run_format");
    expect(byId.has("ok")).toBe(false);
  });

  it("una K mayúscula ALMACENADA se marca run_not_normalized (el motor la rechaza igual)", () => {
    const input: ActionPreflightInput = {
      ...baseInput(),
      // 1000005-k: DV real es 'k'. Si quedó guardada en mayúscula (edición
      // manual — el import normaliza antes de persistir), el motor fallará en
      // cada intento: el checklist lo dice en vez de taparlo.
      enrollments: [{ enrollmentId: "k", run: "1000005-K", exento: false }],
    };
    const r = evaluateActionPreflight(input);
    expect(r.invalidRuns).toHaveLength(1);
    expect(r.invalidRuns[0]?.rule).toBe("run_not_normalized");
    expect(item(r, "runs").status).toBe("error");
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

  it("acción TERMINADA (endsOn < hoy) → error datesEnded, no el warning de 'ya comenzó' (R-2)", () => {
    const base = baseInput();
    const ended = evaluateActionPreflight({
      ...base,
      action: { ...base.action, startsOn: "2026-05-01", endsOn: "2026-06-30" },
    });
    const i = item(ended, "dates");
    expect(i.status).toBe("error");
    expect(i.detailKey).toBe("datesEnded");
    expect(ended.overall).toBe("error");
  });

  it("guía no enviada → warning; enviada → ok", () => {
    const notSent = evaluateActionPreflight({ ...baseInput(), guideSentAt: null });
    expect(item(notSent, "clave_unica_guide").status).toBe("warning");
    const sent = evaluateActionPreflight(baseInput());
    expect(item(sent, "clave_unica_guide").status).toBe("ok");
  });
});
