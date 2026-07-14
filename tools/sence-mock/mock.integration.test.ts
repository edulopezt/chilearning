/**
 * Suite de integración del mock RCE (tarea 0.6) — corre SIN INTERNET.
 * Levanta el mock local, registra escenarios por su endpoint de control y
 * verifica que emite los callbacks del protocolo REAL (POST form-urlencoded a
 * la URL de callback), ejercitando además la clasificación del dominio (I-4).
 *
 * Cubre casos del gate F0: apertura exitosa, error (mono y multi-código),
 * cierre exitoso, callback tardío, replay/duplicado y abandono de Clave Única
 * (sin callback). La expiración a 3 h, la traducción de TODOS los códigos y la
 * validación de RUN se cubren en las suites unitarias del dominio y de errors.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyCallback,
  createPendingSession,
  DEFAULT_SESSION_MAX_MS,
  type SessionState,
} from "@/modules/sence/domain/session";

const MOCK_PORT = 4113; // distinto del default 4010 para no chocar con un mock en dev
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}`;
const VALID_OTEC = "76543210-3";
const VALID_TOKEN = "00000000-0000-4000-8000-000000000000";

let mock: ChildProcess;
let callbackServer: Server;
let callbackBase = "";

/** Callbacks recibidos, indexados por IdSesionAlumno (puede haber varios: replay). */
const received = new Map<string, Array<Record<string, string>>>();

function recordCallback(body: Record<string, string>): void {
  const key = body.IdSesionAlumno ?? "(sin-correlador)";
  const list = received.get(key) ?? [];
  list.push(body);
  received.set(key, list);
}

async function waitForPort(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${url}/_mock/health`);
      if (res.ok) return;
    } catch {
      // aún no levanta
    }
    if (Date.now() > deadline) throw new Error(`el mock no respondió en ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function registerScenario(scenario: unknown): Promise<void> {
  const res = await fetch(`${MOCK_BASE}/_mock/scenario`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(scenario),
  });
  if (!res.ok) throw new Error(`registro de escenario falló: ${res.status}`);
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

async function iniciarSesion(fields: Record<string, string>): Promise<Response> {
  return fetch(`${MOCK_BASE}/rcetest/Registro/IniciarSesion`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form(fields),
  });
}

/** Bloquea hasta que el mock haya despachado todos los callbacks programados. */
async function waitIdle(): Promise<void> {
  await fetch(`${MOCK_BASE}/_mock/idle`);
}

function baseStartFields(idSesionAlumno: string): Record<string, string> {
  return {
    RutOtec: VALID_OTEC,
    Token: VALID_TOKEN,
    CodSence: "1234567890",
    CodigoCurso: "ACC-0001",
    LineaCapacitacion: "3",
    RunAlumno: "5126663-3",
    IdSesionAlumno: idSesionAlumno,
    UrlRetoma: `${callbackBase}/cb`,
    UrlError: `${callbackBase}/cb`,
  };
}

beforeAll(async () => {
  // Receptor de callbacks (hace de /api/sence/cb del motor).
  callbackServer = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = Object.fromEntries(new URLSearchParams(raw));
      recordCallback(body);
      res.statusCode = 200;
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => callbackServer.listen(0, "127.0.0.1", resolve));
  const addr = callbackServer.address() as AddressInfo;
  callbackBase = `http://127.0.0.1:${addr.port}`;

  // Levanta el mock como proceso hijo, en un puerto propio y en silencio.
  mock = spawn(process.execPath, ["--no-warnings", "tools/sence-mock/server.ts"], {
    env: { ...process.env, PORT: String(MOCK_PORT), SENCE_MOCK_QUIET: "1" },
    stdio: "ignore",
  });
  await waitForPort(MOCK_BASE);
});

afterAll(async () => {
  mock?.kill();
  await new Promise<void>((resolve) => callbackServer.close(() => resolve()));
});

describe("mock RCE — callbacks del protocolo real (gate F0)", () => {
  it("apertura exitosa: callback con IdSesionSence → el dominio clasifica start_ok", async () => {
    const corr = "it-start-ok";
    await registerScenario({
      match: { endpoint: "start", idSesionAlumno: corr },
      respond: { kind: "start_ok", idSesionSence: "MOCK-START-1" },
    });
    await iniciarSesion(baseStartFields(corr));
    await waitIdle();

    const callbacks = received.get(corr) ?? [];
    expect(callbacks).toHaveLength(1);
    const cb = callbacks[0]!;
    expect(cb.IdSesionSence).toBe("MOCK-START-1");
    expect(cb.GlosaError).toBeUndefined();

    // El dominio, con una sesión pendiente correlacionada, transiciona a iniciada.
    const pending = createPendingSession(0);
    const result = applyCallback(
      pending,
      { idSesionAlumno: corr, idSesionSence: cb.IdSesionSence, timestampMs: Date.parse("2026-07-14T10:00:00Z") },
      { now: Date.parse("2026-07-14T10:00:01Z"), sessionMaxMs: DEFAULT_SESSION_MAX_MS },
    );
    expect(result.event?.kind).toBe("start_ok");
    expect(result.event?.late).toBe(false);
    expect(result.state.status).toBe("iniciada");
  });

  it("error multi-código: GlosaError '211;204' → el dominio parsea ambos", async () => {
    const corr = "it-start-error";
    await registerScenario({
      match: { endpoint: "start", idSesionAlumno: corr },
      respond: { errorCodes: ["211", "204"] },
    });
    await iniciarSesion(baseStartFields(corr));
    await waitIdle();

    const cb = (received.get(corr) ?? [])[0]!;
    expect(cb.GlosaError).toBe("211;204");
    const result = applyCallback(
      createPendingSession(0),
      { idSesionAlumno: corr, glosaError: cb.GlosaError, idSesionSence: cb.IdSesionSence },
      { now: 1_000, sessionMaxMs: DEFAULT_SESSION_MAX_MS },
    );
    expect(result.event?.kind).toBe("start_error");
    expect([...(result.event?.errorCodes ?? [])]).toEqual(["211", "204"]);
    expect(result.state.status).toBe("error");
  });

  it("cierre exitoso: callback SIN IdSesionSence → close_ok", async () => {
    const corr = "it-close-ok";
    await registerScenario({
      match: { endpoint: "start", idSesionAlumno: corr },
      respond: { kind: "close_ok" },
    });
    await iniciarSesion(baseStartFields(corr));
    await waitIdle();

    const cb = (received.get(corr) ?? [])[0]!;
    expect(cb.IdSesionSence).toBeUndefined();
    expect(cb.GlosaError).toBeUndefined();

    // Simula una sesión ya abierta (T2) y luego el callback de cierre (T5).
    const opened: SessionState = {
      ...createPendingSession(0),
      status: "iniciada",
      openedAt: Date.parse("2026-07-14T10:00:00Z"),
      idSesionSence: "MOCK-OPEN",
    };
    const result = applyCallback(
      opened,
      { idSesionAlumno: corr, idSesionSence: cb.IdSesionSence, timestampMs: Date.parse("2026-07-14T11:00:00Z") },
      { now: Date.parse("2026-07-14T11:00:01Z"), sessionMaxMs: DEFAULT_SESSION_MAX_MS },
    );
    expect(result.event?.kind).toBe("close_ok");
    expect(result.state.status).toBe("cerrada");
  });

  it("callback tardío: se despacha con retraso y el _mock/idle lo espera", async () => {
    const corr = "it-late";
    await registerScenario({
      match: { endpoint: "start", idSesionAlumno: corr },
      respond: { kind: "start_ok", idSesionSence: "MOCK-LATE", delayMs: 400 },
    });
    await iniciarSesion(baseStartFields(corr));
    // Antes del idle, aún no llegó.
    expect(received.get(corr) ?? []).toHaveLength(0);
    await waitIdle();
    expect((received.get(corr) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("replay/duplicado: el mock reenvía el MISMO callback dos veces", async () => {
    const corr = "it-replay";
    await registerScenario({
      match: { endpoint: "start", idSesionAlumno: corr },
      respond: { kind: "start_ok", idSesionSence: "MOCK-REPLAY", repeat: 2 },
    });
    await iniciarSesion(baseStartFields(corr));
    await waitIdle();
    const callbacks = received.get(corr) ?? [];
    expect(callbacks).toHaveLength(2);
    expect(callbacks[0]!.IdSesionSence).toBe(callbacks[1]!.IdSesionSence);
  });

  it("abandono de Clave Única: kind 'none' → NO llega ningún callback (T4)", async () => {
    const corr = "it-no-callback";
    await registerScenario({
      match: { endpoint: "start", idSesionAlumno: corr },
      respond: { kind: "none" },
    });
    await iniciarSesion(baseStartFields(corr));
    await waitIdle();
    expect(received.get(corr) ?? []).toHaveLength(0);
  });

  it("la ruta de producción /rce/* está bloqueada (nunca simula prod)", async () => {
    const res = await fetch(`${MOCK_BASE}/rce/Registro/IniciarSesion`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ RutOtec: VALID_OTEC }),
    });
    expect(res.status).toBe(403);
  });
});
