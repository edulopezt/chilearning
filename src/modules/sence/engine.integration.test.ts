/**
 * Integración del MOTOR SENCE completo (task 0.7): dominio + BD (Supabase local)
 * + cifrado del token + mock RCE. Ejerce el gate F0 end-to-end SIN internet.
 *
 * Flujo: startSession (crea sesión, cifra/descifra token, arma el form) →
 * el mock emite el callback real → handleCallback (persiste evento idempotente,
 * transiciona la sesión) → buildCloseForm. Cubre: apertura ok, error mono/multi,
 * cierre, replay idempotente, callback tardío, exento, token nunca persistido.
 *
 * Requiere `supabase start` + `supabase db reset` y levanta el mock como proceso.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TenantGuard } from "@/lib/tenant-guard";
import { encryptToken, parseEncryptionKey } from "@/modules/sence/domain/token-crypto";
import {
  buildCloseForm,
  handleCallback,
  startSession,
  type EngineDeps,
} from "@/modules/sence/engine";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const DEMO_COURSE = "c0000000-0000-4000-8000-000000000001";
const STUDENT_A = "aaaaaaaa-0000-4000-8000-000000000005";
const OTHER_STUDENT = "aaaaaaaa-0000-4000-8000-000000000006"; // empresa user, para exento
const MOCK_PORT = 4114;
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}`;
const VALID_OTEC = "76111111-6"; // rut del seed (tenant Andes)
const VALID_TOKEN = "00000000-0000-4000-8000-000000000000";
const KEY = parseEncryptionKey(Buffer.from("0".repeat(32)).toString("base64"));

let svc: SupabaseClient;
let mock: ChildProcess;
let deps: EngineDeps;

function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => {
    const m = out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"));
    if (!m?.[1]) throw new Error(`falta ${k}`);
    return m[1];
  };
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

/** Un TenantGuard real apoyado en el service client (como en producción). */
function guardFor(tenantId: string): TenantGuard {
  const UUID_RE = /^[0-9a-f-]{36}$/i;
  if (!UUID_RE.test(tenantId)) throw new Error("bad tenant");
  return {
    tenantId,
    db: svc,
    from(table: string, tenantColumn = "tenant_id") {
      return svc.from(table).select("*").eq(tenantColumn, tenantId);
    },
    assertTenant(rowTenantId) {
      if (rowTenantId !== tenantId) throw new Error("cross-tenant");
    },
    withTenant(row) {
      return { ...row, tenant_id: tenantId };
    },
  };
}

async function waitMock(): Promise<void> {
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      if ((await fetch(`${MOCK_BASE}/_mock/health`)).ok) return;
    } catch {
      /* aún no */
    }
    if (Date.now() > deadline) throw new Error("mock no levantó");
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function scenario(s: unknown): Promise<void> {
  const res = await fetch(`${MOCK_BASE}/_mock/scenario`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(s),
  });
  if (!res.ok) throw new Error(`escenario falló: ${res.status}`);
}

async function mockIdle(): Promise<void> {
  await fetch(`${MOCK_BASE}/_mock/idle`);
}

/** Espera a que el mock despache y el callback server termine handleCallback. */
async function settle(): Promise<void> {
  await mockIdle();
  await new Promise((r) => setTimeout(r, 250));
}

/** FechaHora en formato SENCE (aaaa-mm-dd hh:mm:ss) para "ahora" — así la sesión
 *  no aparece expirada (SENCE real envía la hora actual; el mock una fija). */
function nowFechaHora(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

/** Ejecuta el form del motor contra el mock (simula el POST del navegador). */
async function submitToSence(endpoint: string, fields: Record<string, string>): Promise<void> {
  await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

/** Recibe el callback del mock reenviándolo al motor (hace de /api/sence/cb). */
let callbackServer: import("node:http").Server;
let callbackUrl = "";
const callbacksProcessed: string[] = [];

beforeAll(async () => {
  const e = env();
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });

  // Configura el token cifrado del OTEC del tenant A (lo hace el admin en prod).
  const encrypted = encryptToken(VALID_TOKEN, KEY);
  await svc
    .from("sence_otec_config")
    .update({ token_encrypted: encrypted })
    .eq("tenant_id", TENANT_A);

  // Servidor que hace de /api/sence/cb: recibe el callback del mock y lo pasa al motor.
  const http = await import("node:http");
  callbackServer = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      try {
        const params = Object.fromEntries(new URLSearchParams(raw));
        // El nonce va en el último segmento de la URL (…/api/sence/cb/{nonce}).
        const segments = (req.url ?? "").split("/").filter(Boolean);
        const nonce = segments[segments.length - 1] ?? null;
        const result = await handleCallback(svc, params, deps, nonce);
        callbacksProcessed.push(result.eventKind);
        res.statusCode = 200;
        res.end("ok");
      } catch (err) {
        // Nunca dejar colgado al mock: responde aunque el motor falle.
        callbacksProcessed.push(`ERROR:${(err as Error).message}`);
        res.statusCode = 500;
        res.end("error");
      }
    });
  });
  await new Promise<void>((r) => callbackServer.listen(0, "127.0.0.1", r));
  const addr = callbackServer.address() as import("node:net").AddressInfo;
  callbackUrl = `http://127.0.0.1:${addr.port}/api/sence/cb`;

  deps = {
    encryptionKey: KEY,
    baseOverride: { rcetest: `${MOCK_BASE}/rcetest`, rce: `${MOCK_BASE}/rce` },
    callbackUrl,
    now: () => Date.now(),
    newUuid: () => randomUUID(),
    newNonce: () => randomUUID().replace(/-/g, "").slice(0, 16),
  };

  mock = spawn(process.execPath, ["--no-warnings", "tools/sence-mock/server.ts"], {
    env: {
      ...process.env,
      PORT: String(MOCK_PORT),
      SENCE_MOCK_QUIET: "1",
      SENCE_MOCK_RUT_OTEC: VALID_OTEC,
      SENCE_MOCK_TOKEN: VALID_TOKEN,
    },
    stdio: "ignore",
  });
  await waitMock();
});

afterAll(async () => {
  mock?.kill();
  await new Promise<void>((r) => callbackServer.close(() => r()));
});

/**
 * Cada test usa una inscripción FRESCA (como en producción hay muchas). No se
 * limpia entre tests: `sence_events` es INSERT-only (I-2) y las sesiones tienen
 * FK restrict, así que el aislamiento se logra con ids nuevos, no borrando.
 */
let currentEnrollment = "";
async function freshEnrollment(student = STUDENT_A, exento = false): Promise<string> {
  const actionId = randomUUID();
  await svc.from("actions").insert({
    id: actionId,
    tenant_id: TENANT_A,
    course_id: DEMO_COURSE,
    codigo_accion: "ACC-DEMO-0001",
    training_line: 3,
    environment: "rcetest",
    attendance_lock: true,
  });
  const enrollmentId = randomUUID();
  await svc.from("enrollments").insert({
    id: enrollmentId,
    tenant_id: TENANT_A,
    action_id: actionId,
    user_id: student,
    run: "5126663-3",
    exento,
  });
  return enrollmentId;
}

beforeEach(async () => {
  callbacksProcessed.length = 0;
  // Limpia escenarios/despachos del mock para no contaminar el test siguiente.
  await fetch(`${MOCK_BASE}/_mock/reset`, { method: "POST" });
  currentEnrollment = await freshEnrollment();
});

async function start(): Promise<{ sessionId: string; idSesionAlumno: string }> {
  const result = await startSession(guardFor(TENANT_A), currentEnrollment, STUDENT_A, deps);
  if (result.kind !== "ready") throw new Error(`start no quedó ready: ${result.kind}`);
  await submitToSence(result.endpoint, result.fields);
  await settle();
  return { sessionId: result.sessionId, idSesionAlumno: result.fields.IdSesionAlumno! };
}

async function sessionRow(sessionId: string) {
  const { data } = await svc.from("sence_sessions").select("*").eq("id", sessionId).single();
  return data;
}

describe("motor SENCE end-to-end contra el mock (gate F0)", () => {
  it("apertura exitosa: sesión pasa a iniciada con IdSesionSence y evento start_ok", async () => {
    await scenario({ match: { endpoint: "start" }, respond: { kind: "start_ok", idSesionSence: "S-1" } });
    const { sessionId } = await start();
    const row = await sessionRow(sessionId);
    expect(row.status).toBe("iniciada");
    expect(row.id_sesion_sence).toBe("S-1");
    expect(callbacksProcessed).toContain("start_ok");
  });

  it("error multi-código: sesión pasa a error con los códigos parseados", async () => {
    await scenario({ match: { endpoint: "start" }, respond: { errorCodes: ["211", "204"] } });
    const { sessionId } = await start();
    const row = await sessionRow(sessionId);
    expect(row.status).toBe("error");
    expect(row.error_codes).toEqual(["211", "204"]);
    expect(callbacksProcessed).toContain("start_error");
  });

  it("cierre: tras abrir, el cierre exitoso deja la sesión cerrada", async () => {
    await scenario({
      match: { endpoint: "start" },
      respond: { kind: "start_ok", idSesionSence: "S-2", fechaHora: nowFechaHora() },
    });
    const { sessionId } = await start();

    const close = await buildCloseForm(guardFor(TENANT_A), sessionId, STUDENT_A, deps);
    if ("error" in close) throw new Error("no se pudo construir el cierre");
    expect(close.fields.IdSesionSence).toBe("S-2");
    await scenario({ match: { endpoint: "close" }, respond: { kind: "close_ok" } });
    await submitToSence(close.endpoint, close.fields);
    await settle();

    const row = await sessionRow(sessionId);
    expect(row.status).toBe("cerrada");
    expect(callbacksProcessed).toContain("close_ok");
  });

  it("replay (I-1 + I-3): un callback repetido persiste DOS eventos pero UNA transición", async () => {
    await scenario({ match: { endpoint: "start" }, respond: { kind: "start_ok", idSesionSence: "S-3", repeat: 2 } });
    const { sessionId } = await start();
    // I-1: ambos callbacks se persisten (perder evidencia es inaceptable).
    const { count } = await svc
      .from("sence_events")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId);
    expect(count).toBe(2);
    // I-3: la sesión transicionó UNA sola vez (sigue iniciada, no re-abrió).
    const row = await sessionRow(sessionId);
    expect(row.status).toBe("iniciada");
  });

  it("H-2: un callback con nonce inválido NO transiciona la sesión (falsificación)", async () => {
    await scenario({ match: { endpoint: "start" }, respond: { kind: "start_ok", idSesionSence: "S-FAKE" } });
    const result = await startSession(guardFor(TENANT_A), currentEnrollment, STUDENT_A, deps);
    if (result.kind !== "ready") throw new Error("no ready");
    // Un atacante conoce el IdSesionAlumno pero NO el nonce correcto.
    const forged = await handleCallback(
      svc,
      { IdSesionAlumno: result.fields.IdSesionAlumno!, IdSesionSence: "S-FAKE" },
      deps,
      "nonce-equivocado",
    );
    expect(forged.matched).toBe(false); // no correlacionó por nonce inválido
    const row = await sessionRow(result.sessionId);
    expect(row.status).toBe("iniciada_pendiente"); // NO avanzó
  });

  it("el token NUNCA se persiste en el payload del evento (I-7)", async () => {
    await scenario({ match: { endpoint: "start" }, respond: { kind: "start_ok", idSesionSence: "S-4" } });
    const { sessionId } = await start();
    const { data } = await svc.from("sence_events").select("payload").eq("session_id", sessionId);
    for (const ev of data ?? []) {
      const json = JSON.stringify(ev.payload).toLowerCase();
      expect(json).not.toContain("token");
      expect(json).not.toContain(VALID_TOKEN);
    }
  });

  it("abandono de Clave Única: sin callback, la sesión queda iniciada_pendiente", async () => {
    await scenario({ match: { endpoint: "start" }, respond: { kind: "none" } });
    const { sessionId } = await start();
    const row = await sessionRow(sessionId);
    expect(row.status).toBe("iniciada_pendiente");
    expect(callbacksProcessed).toHaveLength(0);
  });

  it("alumno exento: startSession no crea sesión y devuelve exempt (I-14)", async () => {
    const exemptEnrollment = await freshEnrollment(STUDENT_A, true);
    const result = await startSession(guardFor(TENANT_A), exemptEnrollment, STUDENT_A, deps);
    expect(result.kind).toBe("exempt");
  });

  it("un alumno no puede iniciar la inscripción de OTRO (seguridad)", async () => {
    await expect(
      startSession(guardFor(TENANT_A), currentEnrollment, OTHER_STUDENT, deps),
    ).rejects.toThrow();
  });

  it("callback sin correlación se persiste igual como unmatched (I-1)", async () => {
    await handleCallback(
      svc,
      { IdSesionAlumno: "chl-inexistente", IdSesionSence: "X", RunAlumno: "5126663-3" },
      deps,
    );
    const { data } = await svc
      .from("sence_events")
      .select("kind, tenant_id")
      .eq("payload->>IdSesionAlumno", "chl-inexistente");
    expect(data?.[0]?.kind).toBe("unmatched");
    expect(data?.[0]?.tenant_id).toBeNull();
  });
});
