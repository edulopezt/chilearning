/**
 * Local RCE mock — fake SENCE "Registro de Asistencia E-Learning" server.
 *
 * Purpose: let the SENCE engine (task 0.7) and its integration suite run with NO internet
 * and without ever touching the real SENCE. Derived LITERALLY from the frozen contract
 * `src/modules/sence/README.md` (invariants I-1..I-16, transitions T1..T9, error table §5)
 * and the protocol spec `docs/sence/SPEC_INTEGRACION_SENCE.md` (manual v1.1.6).
 *
 * Design decisions (rationale in ./README.md):
 *  - Zero dependencies: `node:http` only. Runs with `node tools/sence-mock/server.ts`
 *    (Node >= 24 strips types natively). No Express, so no ADR needed.
 *  - Callbacks are dispatched SERVER-TO-SERVER (POST, x-www-form-urlencoded) to
 *    UrlRetoma / UrlError, exactly like SENCE posts them — but without needing a browser.
 *    That keeps the integration tests deterministic (see README "Why server-to-server").
 *  - Scenarios are forced through the control endpoint `/_mock/scenario`, NEVER through
 *    magic values inside protocol fields: the wire stays byte-identical to the real
 *    protocol and no fake marker can ever be confused with (or persisted as) real data.
 *  - The OTEC Token is NEVER logged, echoed, stored in dispatch records nor returned by
 *    any endpoint (I-6). Callbacks carry no Token by protocol design (I-7).
 *  - Deprecated codes 100 and 210 are REFUSED: the contract (§5 notes) forbids this mock
 *    from ever emitting them.
 */

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Endpoint = "start" | "close";

/** Class of callback SENCE posts back (contract I-4 / spec §5a-5d). */
type CallbackKind = "start_ok" | "start_error" | "close_ok" | "close_error";

/** What a forced scenario makes the mock do. "none" = no callback at all (T4). */
type ScenarioKind = "start_ok" | "close_ok" | "error" | "none";

type Quirks = {
  /** Omit ZonaHoraria from the callback (observed in production, spec §5.2). */
  omitZonaHoraria: boolean;
  /** Emit field names with a trailing space ("LineaCapacitacion ") — manual Anexo 3 errata. */
  trailingSpaceFieldNames: boolean;
};

type ScenarioMatch = {
  endpoint?: Endpoint;
  runAlumno?: string;
  idSesionAlumno?: string;
  idSesionSence?: string;
  codSence?: string;
  codigoCurso?: string;
};

type ScenarioRespond = {
  kind?: ScenarioKind;
  /** Raw GlosaError value, e.g. "211" or "211;204" (I-5: it is a `;`-separated list). */
  glosaError?: string;
  delayMs: number;
  /** How many times the SAME callback is posted — >1 reproduces replay/duplicate (I-3). */
  repeat: number;
  idSesionSence?: string;
  fechaHora?: string;
  zonaHoraria?: string;
  quirks: Quirks;
};

type Scenario = {
  id: string;
  match: ScenarioMatch;
  respond: ScenarioRespond;
  /** Remaining uses; `null` = unlimited ("always"). */
  remaining: number | null;
  createdAt: string;
  usedCount: number;
};

type MockSession = {
  idSesionSence: string;
  idSesionAlumno: string;
  runAlumno: string;
  codSence: string;
  codigoCurso: string;
  lineaCapacitacion: string;
  openedAt: string;
  closedAt: string | null;
};

type DispatchRecord = {
  id: string;
  endpoint: Endpoint;
  kind: CallbackKind;
  url: string;
  /** 1-based index within a `repeat` burst (attempt 2 of 2 == the replay). */
  attempt: number;
  repeat: number;
  delayMs: number;
  scenarioId: string | null;
  /** Exact form fields posted back. Never contains Token (I-6, I-7). */
  fields: Record<string, string>;
  scheduledAt: string;
  dispatchedAt: string | null;
  responseStatus: number | null;
  error: string | null;
};

type MockConfig = {
  /** RUT of the test OTEC the mock considers valid (fictitious data only). */
  rutOtec: string;
  /** Expected OTEC token. Kept in memory, never exposed. */
  token: string;
  /** 211 is raised when the token is valid-looking but does not belong to this OTEC. */
  tokenState: "vigente" | "revocado";
  /** RUNs authorized for the course. `null` = everyone authorized (default). Else 208. */
  authorizedRuns: string[] | null;
  /** Reject CerrarSesion with an IdSesionSence this mock never issued (error 304). */
  strictCloseSession: boolean;
};

type ValidationResult = { ok: true } | { ok: false; code: string };

type FormFields = Map<string, string>;

// ---------------------------------------------------------------------------
// Error codes — derived from the contract's table (src/modules/sence/README.md §5)
// ---------------------------------------------------------------------------
//
// The mock only ever sends CODES: the protocol's `GlosaError` field carries the error
// identifier, not the sentence. The verbatim official glosas and their es-CL translations
// live in `src/modules/sence/errors.ts` + `src/i18n/es-CL.ts` (I-9) — duplicating them here
// would create a second source of truth and let them drift.

/** Every non-deprecated code of contract §5: 200-212 without 210, plus 300-313. */
const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set([
  "200",
  "201",
  "202",
  "203",
  "204",
  "205",
  "206",
  "207",
  "208",
  "209",
  "211",
  "212",
  "300",
  "301",
  "302",
  "303",
  "304",
  "305",
  "306",
  "307",
  "308",
  "309",
  "310",
  "311",
  "312",
  "313",
]);

/**
 * Codes 100 and 210 exist only in manual v1.1.3 and were removed in v1.1.5/v1.1.6.
 * Contract §5: "se mantienen en errors.ts SOLO como entradas deprecated [...] el mock
 * (tarea 0.6) NO los emite." Forcing them through /_mock/scenario is refused.
 */
const DEPRECATED_ERROR_CODES: ReadonlySet<string> = new Set(["100", "210"]);

// ---------------------------------------------------------------------------
// Field limits (manual v1.1.6 §3.2 / §3.3 — spec §4 and §6)
// ---------------------------------------------------------------------------

const MAX_LEN = {
  RutOtec: 10,
  Token: 36,
  CodSence: 10,
  CodigoCurso: 50,
  RunAlumno: 10,
  IdSesionAlumno: 149,
  IdSesionSence: 149,
  UrlRetoma: 100,
  UrlError: 100,
} as const;

const VALID_TRAINING_LINES: ReadonlySet<string> = new Set(["1", "3", "6"]);

/** In `rcetest`, "-1" disables code verification (manual §4 / spec §3.1). */
const WILDCARD_CODE = "-1";

const MIN_ACTION_CODE_LEN = 7;

// ---------------------------------------------------------------------------
// Configuration & mutable state
// ---------------------------------------------------------------------------

const PORT = Number.parseInt(process.env.PORT ?? "4010", 10);
const HOST = process.env.SENCE_MOCK_HOST ?? "127.0.0.1";
const QUIET = process.env.SENCE_MOCK_QUIET === "1";

/** Fictitious defaults — never real OTEC data (project hard rule). */
const DEFAULT_RUT_OTEC = "76543210-3";
const DEFAULT_TOKEN = "00000000-0000-4000-8000-000000000000"; // 36 chars, GUID-shaped

function defaultConfig(): MockConfig {
  return {
    rutOtec: process.env.SENCE_MOCK_RUT_OTEC ?? DEFAULT_RUT_OTEC,
    token: process.env.SENCE_MOCK_TOKEN ?? DEFAULT_TOKEN,
    tokenState: "vigente",
    authorizedRuns: null,
    strictCloseSession: true,
  };
}

let config: MockConfig = defaultConfig();
let scenarios: Scenario[] = [];
let dispatches: DispatchRecord[] = [];
const sessions: Map<string, MockSession> = new Map();

/** Number of callbacks scheduled or in flight — backs GET /_mock/idle. */
let pendingCallbacks = 0;

// ---------------------------------------------------------------------------
// Logging — the Token NEVER reaches a log line (I-6)
// ---------------------------------------------------------------------------

function log(message: string, detail?: Record<string, unknown>): void {
  if (QUIET) return;
  const suffix = detail === undefined ? "" : ` ${JSON.stringify(detail)}`;
  process.stdout.write(`[sence-mock] ${message}${suffix}\n`);
}

/** Strips Token from any field bag before it can be logged or returned (I-6). */
function redact(fields: FormFields): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of fields) {
    if (key === "Token") continue;
    out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small narrowing helpers (no `any`, no Zod — this tool has zero dependencies)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new BadRequest(`"${field}" must be a string`);
  return value;
}

function optBool(value: unknown, field: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new BadRequest(`"${field}" must be a boolean`);
  return value;
}

function optInt(value: unknown, field: string, fallback: number, min: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new BadRequest(`"${field}" must be an integer >= ${min}`);
  }
  return value;
}

class BadRequest extends Error {}

// ---------------------------------------------------------------------------
// Chilean RUN/RUT validation (modulo 11) — the real RCE answers 207 / 209 on failure
// ---------------------------------------------------------------------------

/** Accepts `xxxxxxxx-x` only: no dots, single hyphen, DV 0-9 or k/K (spec §9). */
function isValidRut(value: string): boolean {
  if (!/^\d{1,8}-[\dkK]$/.test(value)) return false;
  const parts = value.split("-");
  const body = parts[0];
  const dv = parts[1];
  if (body === undefined || dv === undefined) return false;

  let sum = 0;
  let weight = 2;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    const digit = Number(body[i]);
    sum += digit * weight;
    weight = weight === 7 ? 2 : weight + 1;
  }
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? "0" : remainder === 10 ? "k" : String(remainder);
  return dv.toLowerCase() === expected;
}

// ---------------------------------------------------------------------------
// Protocol helpers
// ---------------------------------------------------------------------------

/**
 * Parses the form body. Field names are trimmed on the way IN because the manual's own
 * example reads `request.form("LineaCapacitacion ")` (spec §5.2, defensive parsing).
 */
function parseForm(body: string): FormFields {
  const fields: FormFields = new Map();
  for (const [rawKey, value] of new URLSearchParams(body)) {
    fields.set(rawKey.trim(), value);
  }
  return fields;
}

function get(fields: FormFields, name: string): string {
  return fields.get(name) ?? "";
}

/** A mandatory parameter is missing when absent OR only whitespace (error 200). */
function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** `aaaa-mm-dd hh:mm:ss` (Texto 19) in Chilean time, as the real callbacks send it. */
function senceTimestamp(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}:${pick("second")}`;
}

function tokenMatches(received: string): boolean {
  const expected = Buffer.from(config.token, "utf8");
  const actual = Buffer.from(received, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------------------
// Validation — mirrors the real RCE. Order is documented in README §"Validation order".
// Returns the FIRST error code the real service would answer with.
// ---------------------------------------------------------------------------

function validateRequest(endpoint: Endpoint, fields: FormFields): ValidationResult {
  const codSence = get(fields, "CodSence");
  const codigoCurso = get(fields, "CodigoCurso");
  const linea = get(fields, "LineaCapacitacion").trim();
  const runAlumno = get(fields, "RunAlumno").trim();
  const rutOtec = get(fields, "RutOtec").trim();
  const token = get(fields, "Token");
  const idSesionAlumno = get(fields, "IdSesionAlumno");
  const idSesionSence = get(fields, "IdSesionSence");

  // 200 — mandatory parameters missing / blank / misspelled.
  // CodSence is the documented exception: it MUST be blank on line 1 (I-10, Anexo 5).
  const isLine1 = linea === "1";
  const mandatory: Array<[string, string]> = [
    ["RutOtec", rutOtec],
    ["Token", token],
    ["CodigoCurso", codigoCurso],
    ["LineaCapacitacion", linea],
    ["RunAlumno", runAlumno],
    ["IdSesionAlumno", idSesionAlumno],
  ];
  if (!isLine1) mandatory.push(["CodSence", codSence]);
  if (endpoint === "close") mandatory.push(["IdSesionSence", idSesionSence]);

  for (const entry of mandatory) {
    const value = entry[1];
    if (isBlank(value)) return { ok: false, code: "200" };
  }

  // Over-length correlators are not a protocol code of their own; the real service treats
  // malformed mandatory input as 200 (mock decision, see README "Length -> code mapping").
  if (idSesionAlumno.length > MAX_LEN.IdSesionAlumno) return { ok: false, code: "200" };
  if (idSesionSence.length > MAX_LEN.IdSesionSence) return { ok: false, code: "200" };

  // 206 — training line must be 1, 3 or 6.
  if (!VALID_TRAINING_LINES.has(linea)) return { ok: false, code: "206" };

  // 207 / 209 — RUN and RUT format + check digit.
  if (runAlumno.length > MAX_LEN.RunAlumno || !isValidRut(runAlumno)) {
    return { ok: false, code: "207" };
  }
  if (rutOtec.length > MAX_LEN.RutOtec || !isValidRut(rutOtec)) {
    return { ok: false, code: "209" };
  }

  // 303 / 211 / 212 — token existence, ownership, validity.
  if (token.length !== MAX_LEN.Token) return { ok: false, code: "303" };
  if (rutOtec.toLowerCase() !== config.rutOtec.toLowerCase()) {
    // Right-shaped token presented together with an OTEC it does not belong to.
    return { ok: false, code: "211" };
  }
  if (!tokenMatches(token)) return { ok: false, code: "211" };
  if (config.tokenState === "revocado") return { ok: false, code: "212" };

  // 204 / 205 — course and action codes. `-1` disables verification in rcetest only, and
  // this mock only ever serves rcetest (the /rce/* routes are refused outright).
  // On line 1 CodSence is skipped ON PURPOSE: Anexo 5 requires it EMPTY there, and the frozen
  // contract's error table (§5) defines NO rejection code for a *populated* line-1 CodSence
  // (204 is "menos de 10 caracteres", which a filled value is not; 200 is missing/blank).
  // Inventing a rejection would improvise beyond the contract — enforcing "empty CodSence on
  // line 1" is the ENGINE's pre-flight duty (I-8/I-10), proven by the engine's own test.
  if (!isLine1 && codSence !== WILDCARD_CODE) {
    if (!/^\d{10}$/.test(codSence)) return { ok: false, code: "204" };
  }
  if (codigoCurso !== WILDCARD_CODE) {
    const exemptFromMinLength = linea === "6"; // FPT is exempt (spec §4.2)
    if (codigoCurso.length > MAX_LEN.CodigoCurso) return { ok: false, code: "205" };
    if (!exemptFromMinLength && codigoCurso.trim().length < MIN_ACTION_CODE_LEN) {
      return { ok: false, code: "205" };
    }
  }

  // 208 — RUN not authorized for the course (roster is configurable; null = allow all).
  const roster = config.authorizedRuns;
  if (roster !== null && !roster.some((r) => r.toLowerCase() === runAlumno.toLowerCase())) {
    return { ok: false, code: "208" };
  }

  // 304 — closing a session this mock never opened (mock decision; see README).
  if (endpoint === "close" && config.strictCloseSession && !sessions.has(idSesionSence)) {
    return { ok: false, code: "304" };
  }

  return { ok: true };
}

/**
 * URL validation runs BEFORE everything else: without a usable UrlError the mock has
 * nowhere to post the failure, exactly like the real service.
 * 201 = missing, 202 = UrlRetoma malformed, 203 = UrlError malformed.
 */
function validateCallbackUrls(fields: FormFields): ValidationResult {
  const urlRetoma = get(fields, "UrlRetoma").trim();
  const urlError = get(fields, "UrlError").trim();

  if (isBlank(urlRetoma) || isBlank(urlError)) return { ok: false, code: "201" };
  if (urlRetoma.length > MAX_LEN.UrlRetoma || !isAbsoluteHttpUrl(urlRetoma)) {
    return { ok: false, code: "202" };
  }
  if (urlError.length > MAX_LEN.UrlError || !isAbsoluteHttpUrl(urlError)) {
    return { ok: false, code: "203" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Callback construction (spec §5a-5d — the exact field sets of the manual)
// ---------------------------------------------------------------------------

type CallbackPlan = {
  kind: CallbackKind;
  url: string;
  fields: FormFields;
  delayMs: number;
  repeat: number;
  scenarioId: string | null;
};

function buildCallbackFields(
  request: FormFields,
  kind: CallbackKind,
  options: {
    idSesionSence: string;
    glosaError?: string;
    fechaHora: string;
    zonaHoraria: string;
    quirks: Quirks;
  },
): FormFields {
  const out: FormFields = new Map();

  // Echoed verbatim from the request, as the real service does.
  out.set("CodSence", get(request, "CodSence"));
  out.set("CodigoCurso", get(request, "CodigoCurso"));
  out.set("IdSesionAlumno", get(request, "IdSesionAlumno"));

  // 5a / 5b carry IdSesionSence (on a start ERROR it may legitimately arrive EMPTY — I-4,
  // contract T3). 5c / 5d (close) never carry it at all.
  if (kind === "start_ok" || kind === "start_error") {
    out.set("IdSesionSence", options.idSesionSence);
  }

  out.set("RunAlumno", get(request, "RunAlumno"));
  out.set("FechaHora", options.fechaHora);
  if (!options.quirks.omitZonaHoraria) {
    out.set("ZonaHoraria", options.zonaHoraria);
  }
  out.set("LineaCapacitacion", get(request, "LineaCapacitacion"));

  if (kind === "start_error" || kind === "close_error") {
    out.set("GlosaError", options.glosaError ?? "");
  }

  if (!options.quirks.trailingSpaceFieldNames) return out;

  // Manual Anexo 3 errata reproduction: emit names with a trailing space.
  const quirked: FormFields = new Map();
  for (const [key, value] of out) quirked.set(`${key} `, value);
  return quirked;
}

function encodeForm(fields: FormFields): string {
  const params = new URLSearchParams();
  for (const [key, value] of fields) params.append(key, value);
  return params.toString();
}

/**
 * Posts the callback to UrlRetoma/UrlError, server-to-server, exactly as SENCE would post
 * it from the student's browser. `repeat > 1` posts the very same body again (I-3 replay).
 */
async function dispatchCallback(plan: CallbackPlan, endpoint: Endpoint): Promise<void> {
  const body = encodeForm(plan.fields);
  const fieldsForRecord = redact(plan.fields);

  for (let attempt = 1; attempt <= plan.repeat; attempt += 1) {
    const record: DispatchRecord = {
      id: randomUUID(),
      endpoint,
      kind: plan.kind,
      url: plan.url,
      attempt,
      repeat: plan.repeat,
      delayMs: plan.delayMs,
      scenarioId: plan.scenarioId,
      fields: fieldsForRecord,
      scheduledAt: new Date().toISOString(),
      dispatchedAt: null,
      responseStatus: null,
      error: null,
    };
    dispatches.push(record);

    try {
      const response = await fetch(plan.url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      record.responseStatus = response.status;
      record.dispatchedAt = new Date().toISOString();
      log(`callback ${plan.kind} -> ${plan.url}`, {
        attempt,
        of: plan.repeat,
        status: response.status,
      });
    } catch (error: unknown) {
      record.error = error instanceof Error ? error.message : String(error);
      record.dispatchedAt = new Date().toISOString();
      log(`callback ${plan.kind} FAILED -> ${plan.url}`, { attempt, error: record.error });
    }
  }
}

function scheduleCallback(plan: CallbackPlan, endpoint: Endpoint): Promise<void> {
  pendingCallbacks += 1;
  const run = async (): Promise<void> => {
    try {
      await dispatchCallback(plan, endpoint);
    } finally {
      pendingCallbacks -= 1;
    }
  };

  if (plan.delayMs <= 0) return run();

  // Late callback: answer the browser now, post back later (contract I-15 / gate case 4).
  void new Promise<void>((resolve) => {
    setTimeout(() => {
      void run().then(resolve);
    }, plan.delayMs);
  });
  return Promise.resolve();
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

function matchesScenario(scenario: Scenario, endpoint: Endpoint, fields: FormFields): boolean {
  const m = scenario.match;
  if (m.endpoint !== undefined && m.endpoint !== endpoint) return false;
  if (m.runAlumno !== undefined && m.runAlumno !== get(fields, "RunAlumno").trim()) return false;
  if (m.idSesionAlumno !== undefined && m.idSesionAlumno !== get(fields, "IdSesionAlumno")) {
    return false;
  }
  if (m.idSesionSence !== undefined && m.idSesionSence !== get(fields, "IdSesionSence")) {
    return false;
  }
  if (m.codSence !== undefined && m.codSence !== get(fields, "CodSence")) return false;
  if (m.codigoCurso !== undefined && m.codigoCurso !== get(fields, "CodigoCurso")) return false;
  return true;
}

function takeScenario(endpoint: Endpoint, fields: FormFields): Scenario | null {
  for (const scenario of scenarios) {
    if (scenario.remaining !== null && scenario.remaining <= 0) continue;
    if (!matchesScenario(scenario, endpoint, fields)) continue;
    scenario.usedCount += 1;
    if (scenario.remaining !== null) scenario.remaining -= 1;
    return scenario;
  }
  return null;
}

function parseGlosaError(raw: string): string[] {
  return raw
    .split(";")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function parseScenario(payload: unknown): Scenario {
  if (!isRecord(payload)) throw new BadRequest("body must be a JSON object");

  const rawMatch = payload["match"];
  if (rawMatch !== undefined && !isRecord(rawMatch)) throw new BadRequest('"match" must be an object');
  const matchSource: Record<string, unknown> = isRecord(rawMatch) ? rawMatch : {};

  const endpoint = optString(matchSource["endpoint"], "match.endpoint");
  if (endpoint !== undefined && endpoint !== "start" && endpoint !== "close") {
    throw new BadRequest('"match.endpoint" must be "start" or "close"');
  }

  const match: ScenarioMatch = {
    endpoint,
    runAlumno: optString(matchSource["runAlumno"], "match.runAlumno"),
    idSesionAlumno: optString(matchSource["idSesionAlumno"], "match.idSesionAlumno"),
    idSesionSence: optString(matchSource["idSesionSence"], "match.idSesionSence"),
    codSence: optString(matchSource["codSence"], "match.codSence"),
    codigoCurso: optString(matchSource["codigoCurso"], "match.codigoCurso"),
  };

  const rawRespond = payload["respond"];
  if (rawRespond !== undefined && !isRecord(rawRespond)) {
    throw new BadRequest('"respond" must be an object');
  }
  const respondSource: Record<string, unknown> = isRecord(rawRespond) ? rawRespond : {};

  const kind = optString(respondSource["kind"], "respond.kind");
  if (
    kind !== undefined &&
    kind !== "start_ok" &&
    kind !== "close_ok" &&
    kind !== "error" &&
    kind !== "none"
  ) {
    throw new BadRequest('"respond.kind" must be one of: start_ok, close_ok, error, none');
  }

  // Accept either the raw string ("211;204") or an array of codes (["211","204"]).
  let glosaError = optString(respondSource["glosaError"], "respond.glosaError");
  const rawCodes = respondSource["errorCodes"];
  if (rawCodes !== undefined) {
    if (!Array.isArray(rawCodes) || rawCodes.some((c) => typeof c !== "string")) {
      throw new BadRequest('"respond.errorCodes" must be an array of strings');
    }
    glosaError = (rawCodes as string[]).join(";");
  }

  if (glosaError !== undefined) {
    const codes = parseGlosaError(glosaError);
    if (codes.length === 0) throw new BadRequest('"respond.glosaError" carries no code');
    for (const code of codes) {
      if (DEPRECATED_ERROR_CODES.has(code)) {
        throw new BadRequest(
          `error code ${code} is DEPRECATED (manual v1.1.3 only). The frozen contract ` +
            "(src/modules/sence/README.md §5) forbids this mock from emitting it.",
        );
      }
    }
    // Unknown codes ARE allowed on purpose: they exercise the engine's mandatory fallback
    // for codes outside the table (I-9).
    const unknown = codes.filter((code) => !KNOWN_ERROR_CODES.has(code));
    if (unknown.length > 0) {
      log("scenario forces unknown error code(s) — exercising the I-9 fallback", { unknown });
    }
  }

  const rawQuirks = respondSource["quirks"];
  if (rawQuirks !== undefined && !isRecord(rawQuirks)) {
    throw new BadRequest('"respond.quirks" must be an object');
  }
  const quirksSource: Record<string, unknown> = isRecord(rawQuirks) ? rawQuirks : {};

  const respond: ScenarioRespond = {
    kind,
    glosaError,
    delayMs: optInt(respondSource["delayMs"], "respond.delayMs", 0, 0),
    repeat: optInt(respondSource["repeat"], "respond.repeat", 1, 1),
    idSesionSence: optString(respondSource["idSesionSence"], "respond.idSesionSence"),
    fechaHora: optString(respondSource["fechaHora"], "respond.fechaHora"),
    zonaHoraria: optString(respondSource["zonaHoraria"], "respond.zonaHoraria"),
    quirks: {
      omitZonaHoraria: optBool(quirksSource["omitZonaHoraria"], "respond.quirks.omitZonaHoraria"),
      trailingSpaceFieldNames: optBool(
        quirksSource["trailingSpaceFieldNames"],
        "respond.quirks.trailingSpaceFieldNames",
      ),
    },
  };

  const rawTimes = payload["times"];
  let remaining: number | null = 1;
  if (rawTimes === "always") {
    remaining = null;
  } else if (rawTimes !== undefined) {
    remaining = optInt(rawTimes, "times", 1, 1);
  }

  return {
    id: randomUUID(),
    match,
    respond,
    remaining,
    createdAt: new Date().toISOString(),
    usedCount: 0,
  };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

/** Dev-facing pages of a test tool: English on purpose, never product UI (no es-CL here). */
function sendHtml(res: ServerResponse, status: number, title: string, detail: string): void {
  const body = `<!doctype html><meta charset="utf-8"><title>SENCE RCE mock — ${title}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:3rem auto;max-width:44rem;padding:0 1rem}
code{background:#f2f2f2;padding:.1rem .3rem;border-radius:.2rem}</style>
<h1>SENCE RCE mock</h1><h2>${title}</h2><p>${detail}</p>
<p><small>Local mock — never talks to SENCE. See <code>tools/sence-mock/README.md</code>.</small></p>`;
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

// ---------------------------------------------------------------------------
// Protocol endpoints
// ---------------------------------------------------------------------------

async function handleProtocol(
  endpoint: Endpoint,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    // Mock-only strictness: the real RCE always receives an HTML form POST.
    sendHtml(
      res,
      415,
      "Unsupported Media Type",
      "The RCE protocol posts <code>application/x-www-form-urlencoded</code> forms.",
    );
    return;
  }

  const fields = parseForm(await readBody(req));
  log(`${endpoint === "start" ? "IniciarSesion" : "CerrarSesion"} received`, redact(fields));

  // 1) Callback URLs first: without a usable UrlError there is nowhere to report failure.
  const urlCheck = validateCallbackUrls(fields);
  if (!urlCheck.ok) {
    log(`rejected before callback (no usable URLs)`, { code: urlCheck.code });
    sendHtml(
      res,
      400,
      `Error ${urlCheck.code}`,
      `UrlRetoma/UrlError are missing or malformed, so no callback can be posted. ` +
        `The real service answers <code>${urlCheck.code}</code> here.`,
    );
    return;
  }

  const urlRetoma = get(fields, "UrlRetoma").trim();
  const urlError = get(fields, "UrlError").trim();

  // 2) A forced scenario short-circuits validation — that is the whole point of forcing.
  const scenario = takeScenario(endpoint, fields);
  if (scenario !== null) {
    await respondWithScenario(endpoint, fields, scenario, urlRetoma, urlError, res);
    return;
  }

  // 3) No scenario: behave like the real RCE.
  const check = validateRequest(endpoint, fields);
  if (!check.ok) {
    const kind: CallbackKind = endpoint === "start" ? "start_error" : "close_error";
    await emit(endpoint, kind, fields, {
      url: urlError,
      glosaError: check.code,
      // A start error legitimately carries an EMPTY IdSesionSence (pre-session case, I-4/T3);
      // a close error carries none at all (buildCallbackFields omits it for close_*).
      idSesionSence: "",
      delayMs: 0,
      repeat: 1,
      scenarioId: null,
      quirks: { omitZonaHoraria: false, trailingSpaceFieldNames: false },
    });
    sendHtml(
      res,
      200,
      `Error ${check.code}`,
      `Validation failed. Error callback posted to <code>${urlError}</code>.`,
    );
    return;
  }

  if (endpoint === "start") {
    const idSesionSence = openSession(fields);
    await emit(endpoint, "start_ok", fields, {
      url: urlRetoma,
      idSesionSence,
      delayMs: 0,
      repeat: 1,
      scenarioId: null,
      quirks: { omitZonaHoraria: false, trailingSpaceFieldNames: false },
    });
    sendHtml(
      res,
      200,
      "Inicio de sesión OK",
      `Clave Única accepted (simulated). Success callback posted to <code>${urlRetoma}</code>.`,
    );
    return;
  }

  const closeIdSence = get(fields, "IdSesionSence");
  closeSession(closeIdSence);
  await emit(endpoint, "close_ok", fields, {
    url: urlRetoma,
    idSesionSence: "",
    fechaHora: closeOkFechaHora(closeIdSence),
    delayMs: 0,
    repeat: 1,
    scenarioId: null,
    quirks: { omitZonaHoraria: false, trailingSpaceFieldNames: false },
  });
  sendHtml(
    res,
    200,
    "Cierre de sesión OK",
    `Success callback posted to <code>${urlRetoma}</code> (no IdSesionSence, by protocol).`,
  );
}

async function respondWithScenario(
  endpoint: Endpoint,
  fields: FormFields,
  scenario: Scenario,
  urlRetoma: string,
  urlError: string,
  res: ServerResponse,
): Promise<void> {
  const r = scenario.respond;
  const kind: ScenarioKind =
    r.kind ??
    (r.glosaError !== undefined ? "error" : endpoint === "start" ? "start_ok" : "close_ok");

  // T4 — the student abandons the Clave Única login: SENCE posts NOTHING back, ever.
  if (kind === "none") {
    log("scenario: NO CALLBACK (Clave Única abandonment, T4)", { scenario: scenario.id });
    sendHtml(
      res,
      200,
      "Clave Única (abandoned)",
      "Scenario <code>none</code>: the student is left at the Clave Única login and " +
        "<strong>no callback will ever be posted</strong> (contract T4).",
    );
    return;
  }

  if (kind === "error") {
    const callbackKind: CallbackKind = endpoint === "start" ? "start_error" : "close_error";
    await emit(endpoint, callbackKind, fields, {
      url: urlError,
      glosaError: r.glosaError ?? "300",
      // Default EMPTY on start errors — the pre-session case the engine must survive (I-4).
      idSesionSence: r.idSesionSence ?? "",
      delayMs: r.delayMs,
      repeat: r.repeat,
      scenarioId: scenario.id,
      quirks: r.quirks,
      fechaHora: r.fechaHora,
      zonaHoraria: r.zonaHoraria,
    });
    sendHtml(
      res,
      200,
      `Error ${r.glosaError ?? "300"} (forced)`,
      `Scenario ${scenario.id}: error callback ${r.delayMs > 0 ? `scheduled in ${r.delayMs} ms` : "posted"} to <code>${urlError}</code>.`,
    );
    return;
  }

  if (kind === "start_ok") {
    const idSesionSence = openSession(fields, r.idSesionSence);
    await emit(endpoint, "start_ok", fields, {
      url: urlRetoma,
      idSesionSence,
      delayMs: r.delayMs,
      repeat: r.repeat,
      scenarioId: scenario.id,
      quirks: r.quirks,
      fechaHora: r.fechaHora,
      zonaHoraria: r.zonaHoraria,
    });
    sendHtml(
      res,
      200,
      "Inicio de sesión OK (forced)",
      `Scenario ${scenario.id}: success callback ${r.delayMs > 0 ? `scheduled in ${r.delayMs} ms` : "posted"} to <code>${urlRetoma}</code>.`,
    );
    return;
  }

  const closeIdSence = get(fields, "IdSesionSence");
  closeSession(closeIdSence);
  await emit(endpoint, "close_ok", fields, {
    url: urlRetoma,
    idSesionSence: "",
    delayMs: r.delayMs,
    repeat: r.repeat,
    scenarioId: scenario.id,
    quirks: r.quirks,
    fechaHora: closeOkFechaHora(closeIdSence, r.fechaHora),
    zonaHoraria: r.zonaHoraria,
  });
  sendHtml(
    res,
    200,
    "Cierre de sesión OK (forced)",
    `Scenario ${scenario.id}: close callback ${r.delayMs > 0 ? `scheduled in ${r.delayMs} ms` : "posted"} to <code>${urlRetoma}</code>.`,
  );
}

async function emit(
  endpoint: Endpoint,
  kind: CallbackKind,
  request: FormFields,
  options: {
    url: string;
    idSesionSence: string;
    delayMs: number;
    repeat: number;
    scenarioId: string | null;
    quirks: Quirks;
    glosaError?: string;
    fechaHora?: string;
    zonaHoraria?: string;
  },
): Promise<void> {
  const fields = buildCallbackFields(request, kind, {
    idSesionSence: options.idSesionSence,
    glosaError: options.glosaError,
    fechaHora: options.fechaHora ?? senceTimestamp(),
    zonaHoraria: options.zonaHoraria ?? "America/Santiago",
    quirks: options.quirks,
  });

  await scheduleCallback(
    {
      kind,
      url: options.url,
      fields,
      delayMs: options.delayMs,
      repeat: options.repeat,
      scenarioId: options.scenarioId,
    },
    endpoint,
  );
}

function openSession(fields: FormFields, forcedId?: string): string {
  const idSesionSence = forcedId ?? `MOCK-${randomUUID()}`;
  sessions.set(idSesionSence, {
    idSesionSence,
    idSesionAlumno: get(fields, "IdSesionAlumno"),
    runAlumno: get(fields, "RunAlumno").trim(),
    codSence: get(fields, "CodSence"),
    codigoCurso: get(fields, "CodigoCurso"),
    lineaCapacitacion: get(fields, "LineaCapacitacion").trim(),
    openedAt: new Date().toISOString(),
    closedAt: null,
  });
  return idSesionSence;
}

function closeSession(idSesionSence: string): void {
  const session = sessions.get(idSesionSence);
  if (session !== undefined) session.closedAt = new Date().toISOString();
}

/**
 * Default `FechaHora` for a close-OK callback. The manual (v1.1.3–v1.1.6) literally describes
 * this field as the session's OPEN time, not the close time — contract §3 T5 flags it as a
 * probable manual errata, to be confirmed against real SENCE in checklist 0.9. Reproducing the
 * manual's literal text as the default lets the engine be exercised against the documented
 * `close FechaHora == open FechaHora` case (the engine still keeps its own received_at, I-1).
 * `respond.fechaHora` overrides it; an untracked session (strictCloseSession off, or a forced
 * scenario with no prior open) falls back to the current time.
 */
function closeOkFechaHora(idSesionSence: string, override?: string): string {
  if (override !== undefined) return override;
  const session = sessions.get(idSesionSence);
  if (session !== undefined) return senceTimestamp(new Date(session.openedAt));
  return senceTimestamp();
}

// ---------------------------------------------------------------------------
// Control endpoints (/_mock/*) — the ONLY way to force scenarios
// ---------------------------------------------------------------------------

async function handleControl(
  path: string,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? "GET";

  if (path === "/_mock/health" && method === "GET") {
    sendJson(res, 200, {
      ok: true,
      name: "sence-rce-mock",
      environment: "rcetest",
      port: PORT,
      scenarios: scenarios.length,
      dispatches: dispatches.length,
      sessions: sessions.size,
      pendingCallbacks,
    });
    return;
  }

  if (path === "/_mock/config") {
    if (method === "GET") {
      // The token is NEVER returned — only proof that one is configured (I-6).
      sendJson(res, 200, {
        rutOtec: config.rutOtec,
        token: "[redacted]",
        tokenConfigured: config.token.length > 0,
        tokenState: config.tokenState,
        authorizedRuns: config.authorizedRuns,
        strictCloseSession: config.strictCloseSession,
      });
      return;
    }
    if (method === "POST" || method === "PUT") {
      const payload: unknown = JSON.parse((await readBody(req)) || "{}");
      if (!isRecord(payload)) throw new BadRequest("body must be a JSON object");

      const rutOtec = optString(payload["rutOtec"], "rutOtec");
      if (rutOtec !== undefined) {
        if (!isValidRut(rutOtec)) throw new BadRequest("rutOtec has an invalid check digit");
        config.rutOtec = rutOtec;
      }
      const token = optString(payload["token"], "token");
      if (token !== undefined) config.token = token;

      const tokenState = optString(payload["tokenState"], "tokenState");
      if (tokenState !== undefined) {
        if (tokenState !== "vigente" && tokenState !== "revocado") {
          throw new BadRequest('"tokenState" must be "vigente" or "revocado"');
        }
        config.tokenState = tokenState;
      }

      const runs = payload["authorizedRuns"];
      if (runs === null) {
        config.authorizedRuns = null;
      } else if (runs !== undefined) {
        if (!Array.isArray(runs) || runs.some((r) => typeof r !== "string")) {
          throw new BadRequest('"authorizedRuns" must be an array of strings or null');
        }
        config.authorizedRuns = runs as string[];
      }

      const strict = payload["strictCloseSession"];
      if (strict !== undefined) config.strictCloseSession = optBool(strict, "strictCloseSession");

      log("config updated", { rutOtec: config.rutOtec, tokenState: config.tokenState });
      sendJson(res, 200, { ok: true, tokenConfigured: config.token.length > 0 });
      return;
    }
  }

  if (path === "/_mock/scenario") {
    if (method === "POST") {
      const payload: unknown = JSON.parse((await readBody(req)) || "{}");
      const scenario = parseScenario(payload);
      scenarios.push(scenario);
      log("scenario registered", {
        id: scenario.id,
        match: scenario.match,
        kind: scenario.respond.kind ?? "(inferred)",
        glosaError: scenario.respond.glosaError ?? null,
        delayMs: scenario.respond.delayMs,
        repeat: scenario.respond.repeat,
      });
      sendJson(res, 201, { ok: true, id: scenario.id });
      return;
    }
    if (method === "GET") {
      sendJson(res, 200, scenarios);
      return;
    }
    if (method === "DELETE") {
      scenarios = [];
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  if (path === "/_mock/callbacks" && method === "GET") {
    sendJson(res, 200, dispatches);
    return;
  }

  if (path === "/_mock/sessions" && method === "GET") {
    sendJson(res, 200, [...sessions.values()]);
    return;
  }

  /**
   * Blocks until every scheduled (delayed) callback has been posted — makes tests around
   * late callbacks deterministic without sleeping arbitrary amounts.
   */
  if (path === "/_mock/idle" && method === "GET") {
    const timeoutMs = Number.parseInt(url.searchParams.get("timeoutMs") ?? "10000", 10);
    const deadline = Date.now() + (Number.isFinite(timeoutMs) ? timeoutMs : 10_000);
    while (pendingCallbacks > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    sendJson(res, pendingCallbacks === 0 ? 200 : 504, {
      idle: pendingCallbacks === 0,
      pendingCallbacks,
    });
    return;
  }

  if (path === "/_mock/reset" && method === "POST") {
    scenarios = [];
    dispatches = [];
    sessions.clear();
    config = defaultConfig();
    log("reset");
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: "unknown control endpoint", path, method });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const START_PATHS: ReadonlySet<string> = new Set(["/rcetest/registro/iniciarsesion"]);
const CLOSE_PATHS: ReadonlySet<string> = new Set(["/rcetest/registro/cerrarsesion"]);
const PRODUCTION_PATHS: ReadonlySet<string> = new Set([
  "/rce/registro/iniciarsesion",
  "/rce/registro/cerrarsesion",
]);

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname;
      const lower = path.toLowerCase();
      const method = req.method ?? "GET";

      if (path.startsWith("/_mock/")) {
        await handleControl(path, url, req, res);
        return;
      }

      // The mock NEVER simulates production (`rce`): a green run here must never be
      // mistaken for a production certification, and real attendance is irreversible
      // (manual §5: "Esta información no podrá ser eliminada").
      if (PRODUCTION_PATHS.has(lower)) {
        log("REFUSED a request against the production path (/rce/...)", { path, method });
        sendHtml(
          res,
          403,
          "Production environment refused",
          "This mock only ever serves the <code>rcetest</code> environment. It will never " +
            "simulate <code>rce</code> (production): SENCE attendance written in production " +
            "cannot be deleted. Point the action's <code>environment</code> at " +
            "<code>rcetest</code> and use <code>/rcetest/Registro/…</code>.",
        );
        return;
      }

      if (START_PATHS.has(lower) || CLOSE_PATHS.has(lower)) {
        if (method !== "POST") {
          sendHtml(res, 405, "Method Not Allowed", "The RCE protocol only accepts POST.");
          return;
        }
        await handleProtocol(START_PATHS.has(lower) ? "start" : "close", req, res);
        return;
      }

      sendJson(res, 404, {
        error: "unknown path",
        path,
        hint: "POST /rcetest/Registro/IniciarSesion | POST /rcetest/Registro/CerrarSesion | GET /_mock/health",
      });
    } catch (error: unknown) {
      if (error instanceof BadRequest) {
        sendJson(res, 400, { error: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      log("internal error", { message });
      sendJson(res, 500, { error: "mock internal error", message });
    }
  })();
});

server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT} (rcetest only — production is refused)`);
  log(`OTEC under test: ${config.rutOtec} · token: [configured, redacted]`);
});

const shutdown = (): void => {
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
