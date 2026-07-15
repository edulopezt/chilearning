import { describe, expect, it } from "vitest";

import { validateActivation } from "./action-activation";

describe("validateActivation (task 2.8, HU-3.6)", () => {
  it("exige ambas fechas", () => {
    expect(validateActivation({ startsOn: null, endsOn: "2026-12-31", codigoAccion: "A", originCode: null })).toEqual({
      ok: false,
      error: "missing_dates",
    });
    expect(validateActivation({ startsOn: "2026-07-01", endsOn: null, codigoAccion: "A", originCode: null })).toEqual({
      ok: false,
      error: "missing_dates",
    });
  });

  it("con fechas y sin origen → activa", () => {
    expect(
      validateActivation({ startsOn: "2026-07-01", endsOn: "2026-12-31", codigoAccion: "A", originCode: null }),
    ).toEqual({ ok: true });
  });

  it("re-ejecución: el código NO puede repetir el de origen", () => {
    expect(
      validateActivation({ startsOn: "2026-07-01", endsOn: "2026-12-31", codigoAccion: "ACC-1", originCode: "ACC-1" }),
    ).toEqual({ ok: false, error: "code_unchanged" });
    // Ignora espacios alrededor.
    expect(
      validateActivation({ startsOn: "2026-07-01", endsOn: "2026-12-31", codigoAccion: " ACC-1 ", originCode: "ACC-1" }),
    ).toEqual({ ok: false, error: "code_unchanged" });
  });

  it("re-ejecución con código nuevo → activa", () => {
    expect(
      validateActivation({ startsOn: "2026-07-01", endsOn: "2026-12-31", codigoAccion: "ACC-2", originCode: "ACC-1" }),
    ).toEqual({ ok: true });
  });
});
