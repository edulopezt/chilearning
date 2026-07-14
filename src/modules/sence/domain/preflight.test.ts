import { describe, expect, it } from "vitest";
import {
  isPreflightOk,
  MAX_LENGTH,
  type PreflightField,
  type PreflightInput,
  type PreflightResult,
  type PreflightRule,
  validatePreflight,
} from "./preflight";

/**
 * Every value here is FICTITIOUS. The token is a placeholder GUID-shaped string
 * of the maximum length (36) — it is never a real OTEC token, and the validator
 * never echoes it (I-6).
 */
const FAKE_TOKEN_36 = "00000000-0000-0000-0000-000000000000";

/** A fully valid line-3 (Franquicia Tributaria) start request, on `rce`. */
function baseInput(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    phase: "start",
    environment: "rce",
    trainingLine: 3,
    rutOtec: "12345678-5",
    token: FAKE_TOKEN_36,
    senceCourseCode: "1234567890",
    actionCode: "ACC1234",
    runAlumno: "5126663-3",
    idSesionAlumno: "sess-alumno-0001",
    urlRetoma: "https://tenant.example.cl/api/sence/cb",
    urlError: "https://tenant.example.cl/api/sence/cb",
    ...overrides,
  };
}

function has(result: PreflightResult, field: PreflightField, rule: PreflightRule): boolean {
  if (result.ok) return false;
  return result.violations.some((v) => v.field === field && v.rule === rule);
}

describe("I-8 pre-flight — happy paths", () => {
  it("accepts a valid line-3 start request on rce", () => {
    expect(validatePreflight(baseInput())).toEqual({ ok: true });
    expect(isPreflightOk(baseInput())).toBe(true);
  });

  it("accepts a line-1 request with empty CodSence and a SIC action code (I-10)", () => {
    const result = validatePreflight(
      baseInput({
        trainingLine: 1,
        senceCourseCode: "",
        actionCode: "RLAB-19-02-08-0071-1",
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("accepts a line-6 (FPT) action code shorter than 7 characters", () => {
    const result = validatePreflight(baseInput({ trainingLine: 6, actionCode: "AB12" }));
    expect(result).toEqual({ ok: true });
  });

  it("accepts a valid close request carrying IdSesionSence", () => {
    const result = validatePreflight(
      baseInput({ phase: "close", idSesionSence: "sence-session-xyz" }),
    );
    expect(result).toEqual({ ok: true });
  });
});

describe("I-8 pre-flight — environment (I-11)", () => {
  it("rejects an environment that is neither rcetest nor rce", () => {
    const result = validatePreflight(baseInput({ environment: "prod" }));
    expect(has(result, "environment", "invalid_environment")).toBe(true);
  });

  it("accepts rcetest", () => {
    expect(validatePreflight(baseInput({ environment: "rcetest" }))).toEqual({ ok: true });
  });
});

describe("I-8 pre-flight — LineaCapacitacion ∈ {1,3,6}", () => {
  it("rejects a training line outside {1,3,6}", () => {
    expect(has(validatePreflight(baseInput({ trainingLine: 2 })), "trainingLine", "invalid_training_line")).toBe(true);
    expect(has(validatePreflight(baseInput({ trainingLine: 0 })), "trainingLine", "invalid_training_line")).toBe(true);
  });
});

describe("I-8 pre-flight — RUT OTEC and RUN alumno (format + DV, 'k' lowercased)", () => {
  it("rejects an empty RUT OTEC / RUN alumno as required", () => {
    expect(has(validatePreflight(baseInput({ rutOtec: "" })), "rutOtec", "required")).toBe(true);
    expect(has(validatePreflight(baseInput({ runAlumno: "" })), "runAlumno", "required")).toBe(true);
  });

  it("rejects the dotted format", () => {
    expect(has(validatePreflight(baseInput({ rutOtec: "12.345.678-5" })), "rutOtec", "run_format")).toBe(true);
    expect(has(validatePreflight(baseInput({ runAlumno: "5.126.663-3" })), "runAlumno", "run_format")).toBe(true);
  });

  it("rejects an incorrect check digit", () => {
    expect(has(validatePreflight(baseInput({ rutOtec: "12345678-9" })), "rutOtec", "run_dv")).toBe(true);
    expect(has(validatePreflight(baseInput({ runAlumno: "5126663-4" })), "runAlumno", "run_dv")).toBe(true);
  });

  it("rejects a RUN longer than 10 characters as a format error", () => {
    expect(has(validatePreflight(baseInput({ runAlumno: "123456789-5" })), "runAlumno", "run_format")).toBe(true);
  });

  it("accepts a RUN whose check digit is 'k'", () => {
    // 1000005-k is a valid fictitious RUN (module-11 remainder 10).
    expect(validatePreflight(baseInput({ runAlumno: "1000005-k" }))).toEqual({ ok: true });
  });

  it("rejects an un-normalized uppercase 'K' check digit at the gate (I-8), even with a correct DV", () => {
    // 1000005-K has the correct DV but is NOT normalized to lowercase. The
    // pre-flight is the last gate before the wire, so it must not let an
    // uppercase K through — the "k normalizada a minúscula" guarantee (I-8).
    const runViolation = validatePreflight(baseInput({ runAlumno: "1000005-K" }));
    expect(has(runViolation, "runAlumno", "run_not_normalized")).toBe(true);
    expect(runViolation.ok).toBe(false);
    // Same rule applies to the OTEC RUT.
    const rutViolation = validatePreflight(baseInput({ rutOtec: "1000005-K" }));
    expect(has(rutViolation, "rutOtec", "run_not_normalized")).toBe(true);
    // The lowercase form of the very same RUN passes — proving it is the casing
    // (not the digits) that is rejected.
    expect(validatePreflight(baseInput({ runAlumno: "1000005-k" }))).toEqual({ ok: true });
  });

  it("reports an uppercase K with a WRONG check digit as run_dv, not run_not_normalized", () => {
    // '1234567-K' is not a correct DV, so the more fundamental DV error wins.
    const result = validatePreflight(baseInput({ runAlumno: "1234567-K" }));
    expect(has(result, "runAlumno", "run_dv")).toBe(true);
    expect(has(result, "runAlumno", "run_not_normalized")).toBe(false);
  });
});

describe("I-8 pre-flight — Token (length only, value never inspected, I-6)", () => {
  it("rejects an empty token as required", () => {
    expect(has(validatePreflight(baseInput({ token: "" })), "token", "required")).toBe(true);
  });

  it("rejects a token longer than 36 characters", () => {
    const result = validatePreflight(baseInput({ token: "x".repeat(37) }));
    expect(has(result, "token", "max_length")).toBe(true);
  });

  it("never leaks the token value in a violation", () => {
    const secret = "s".repeat(37);
    const result = validatePreflight(baseInput({ token: secret }));
    const serialized = JSON.stringify(result);
    expect(serialized.includes(secret)).toBe(false);
    // The measured length is fine to report; the value is not.
    expect(serialized.includes('"actual":37')).toBe(true);
  });
});

describe("I-8 pre-flight — CodSence (senceCourseCode) per line + wildcard (I-10)", () => {
  it("line 1 requires CodSence to be empty (Anexo 5)", () => {
    const result = validatePreflight(baseInput({ trainingLine: 1, senceCourseCode: "1234567890", actionCode: "RLAB-19-02-08-0071-1" }));
    expect(has(result, "senceCourseCode", "must_be_empty")).toBe(true);
  });

  it("line 1 rejects even the -1 wildcard in CodSence (it must stay empty)", () => {
    const result = validatePreflight(baseInput({ environment: "rcetest", trainingLine: 1, senceCourseCode: "-1", actionCode: "-1" }));
    expect(has(result, "senceCourseCode", "must_be_empty")).toBe(true);
  });

  it("line 3 requires a non-empty CodSence", () => {
    expect(has(validatePreflight(baseInput({ senceCourseCode: "" })), "senceCourseCode", "required")).toBe(true);
  });

  it("line 3 rejects a CodSence longer than 10 characters", () => {
    expect(has(validatePreflight(baseInput({ senceCourseCode: "12345678901" })), "senceCourseCode", "max_length")).toBe(true);
  });

  it("line 3 rejects a non-10-digit CodSence", () => {
    expect(has(validatePreflight(baseInput({ senceCourseCode: "12345" })), "senceCourseCode", "must_be_numeric")).toBe(true);
    expect(has(validatePreflight(baseInput({ senceCourseCode: "ABCDEFGHIJ" })), "senceCourseCode", "must_be_numeric")).toBe(true);
  });
});

describe("I-8 pre-flight — CodigoCurso (actionCode) length + line-6 exemption", () => {
  it("rejects an empty action code as required", () => {
    expect(has(validatePreflight(baseInput({ actionCode: "" })), "actionCode", "required")).toBe(true);
  });

  it("rejects an action code shorter than 7 chars on lines 1 and 3", () => {
    expect(has(validatePreflight(baseInput({ trainingLine: 3, actionCode: "AB12" })), "actionCode", "min_length")).toBe(true);
  });

  it("rejects an action code longer than 50 chars", () => {
    expect(has(validatePreflight(baseInput({ actionCode: "A".repeat(51) })), "actionCode", "max_length")).toBe(true);
  });
});

describe("I-8 pre-flight — the -1 wildcard is rcetest-only", () => {
  it("accepts CodSence=-1 and CodigoCurso=-1 on rcetest (line 3)", () => {
    const result = validatePreflight(
      baseInput({ environment: "rcetest", senceCourseCode: "-1", actionCode: "-1" }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("REJECTS the -1 wildcard on rce (production)", () => {
    const result = validatePreflight(
      baseInput({ environment: "rce", senceCourseCode: "-1", actionCode: "-1" }),
    );
    expect(has(result, "senceCourseCode", "wildcard_not_allowed")).toBe(true);
    expect(has(result, "actionCode", "wildcard_not_allowed")).toBe(true);
  });

  it("accepts CodigoCurso=-1 on rcetest for line 1 while CodSence stays empty", () => {
    const result = validatePreflight(
      baseInput({ environment: "rcetest", trainingLine: 1, senceCourseCode: "", actionCode: "-1" }),
    );
    expect(result).toEqual({ ok: true });
  });
});

describe("I-8 pre-flight — IdSesionAlumno / IdSesionSence lengths (149)", () => {
  it("rejects an empty IdSesionAlumno as required", () => {
    expect(has(validatePreflight(baseInput({ idSesionAlumno: "" })), "idSesionAlumno", "required")).toBe(true);
  });

  it("rejects an IdSesionAlumno longer than 149 chars", () => {
    const result = validatePreflight(baseInput({ idSesionAlumno: "x".repeat(150) }));
    expect(has(result, "idSesionAlumno", "max_length")).toBe(true);
  });

  it("requires IdSesionSence in the close phase", () => {
    const result = validatePreflight(baseInput({ phase: "close", idSesionSence: "" }));
    expect(has(result, "idSesionSence", "required")).toBe(true);
  });

  it("rejects an IdSesionSence longer than 149 chars", () => {
    const result = validatePreflight(baseInput({ phase: "close", idSesionSence: "y".repeat(150) }));
    expect(has(result, "idSesionSence", "max_length")).toBe(true);
  });

  it("bounds an over-length IdSesionSence in the START phase too (optional, but length-capped)", () => {
    // Start phase does not REQUIRE IdSesionSence, but if one is present it is
    // still length-checked (exercises the else-if branch in validatePreflight).
    const result = validatePreflight(baseInput({ phase: "start", idSesionSence: "x".repeat(150) }));
    expect(has(result, "idSesionSence", "max_length")).toBe(true);
  });

  it("accepts a start request with no IdSesionSence and one of exactly 149 chars", () => {
    expect(validatePreflight(baseInput({ phase: "start" }))).toEqual({ ok: true });
    expect(
      validatePreflight(baseInput({ phase: "start", idSesionSence: "z".repeat(149) })),
    ).toEqual({ ok: true });
  });

  it("bounds MAX_LENGTH.idSesionSence at 149 (contract)", () => {
    expect(MAX_LENGTH.idSesionSence).toBe(149);
  });
});

describe("I-8 pre-flight — callback URLs ≤ 100 chars (v1.1.6)", () => {
  it("rejects empty callback URLs as required", () => {
    expect(has(validatePreflight(baseInput({ urlRetoma: "" })), "urlRetoma", "required")).toBe(true);
    expect(has(validatePreflight(baseInput({ urlError: "" })), "urlError", "required")).toBe(true);
  });

  it("rejects a callback URL longer than 100 chars", () => {
    const longUrl = `https://${"a".repeat(95)}.cl`; // > 100 chars
    expect(longUrl.length).toBeGreaterThan(MAX_LENGTH.urlRetoma);
    expect(has(validatePreflight(baseInput({ urlRetoma: longUrl })), "urlRetoma", "max_length")).toBe(true);
    expect(has(validatePreflight(baseInput({ urlError: longUrl })), "urlError", "max_length")).toBe(true);
  });
});

describe("I-8 pre-flight — accumulates multiple violations", () => {
  it("reports every broken rule at once, not just the first", () => {
    const result = validatePreflight(
      baseInput({ environment: "prod", trainingLine: 2, rutOtec: "bad", runAlumno: "" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.length).toBeGreaterThanOrEqual(4);
    }
  });
});
