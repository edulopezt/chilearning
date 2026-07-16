/**
 * Integración del import de inscripciones (task 1.3): inscribe solo filas
 * válidas, crea usuarios, no duplica al reimportar, respeta permisos y tenant.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { importEnrollmentsFromCsv } from "@/modules/academico/enrollment-service";
import type { EmailSender, OutgoingEmail } from "@/modules/comunicacion/email-sender";
import type { Principal } from "@/modules/core/domain/rbac";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const DEMO_ACTION = "ac000000-0000-4000-8000-000000000001"; // sembrada en tenant A
const DEMO_COURSE = "c0000000-0000-4000-8000-000000000001";

// user_ids REALES del seed: la auditoría escribe actor_user_id (uuid).
const admin: Principal = {
  userId: "aaaaaaaa-0000-4000-8000-000000000001",
  tenantId: TENANT_A,
  roles: ["otec_admin"],
};
const student: Principal = {
  userId: "aaaaaaaa-0000-4000-8000-000000000005",
  tenantId: TENANT_A,
  roles: ["student"],
};

let svc: SupabaseClient;
const createdEmails: string[] = [];

function env() {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string) => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

const MIXED_CSV =
  "nombre,email,run,exento\n" +
  "Ana Díaz,ana.import@otec.cl,16032460-0,no\n" +
  ",sinnombre@otec.cl,12345678-5,no\n" + // inválida: sin nombre
  "Beca Uno,beca.import@otec.cl,9876543-3,si\n" + // exenta
  "RUN Malo,runmalo@otec.cl,12345678-9,no\n"; // inválida: DV

beforeAll(async () => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
});

afterAll(async () => {
  // limpia los usuarios creados por el test
  for (const email of createdEmails) {
    const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
    const u = data?.users.find((x) => x.email?.toLowerCase() === email);
    if (u) await svc.auth.admin.deleteUser(u.id);
  }
});

describe("import de inscripciones (task 1.3, HU-2.2/3.2/3.3)", () => {
  it("un student no puede importar (deny-by-default)", async () => {
    const r = await importEnrollmentsFromCsv(student, DEMO_ACTION, MIXED_CSV);
    expect(r).toEqual({ error: "forbidden" });
  });

  it("una acción de OTRO tenant no es visible (aislamiento)", async () => {
    const otherAdmin: Principal = { userId: "b", tenantId: TENANT_B, roles: ["otec_admin"] };
    const r = await importEnrollmentsFromCsv(otherAdmin, DEMO_ACTION, MIXED_CSV);
    expect(r).toEqual({ error: "action_not_found" });
  });

  it("inscribe SOLO las filas válidas y reporta las inválidas (gate F1)", async () => {
    createdEmails.push("ana.import@otec.cl", "beca.import@otec.cl");
    const r = await importEnrollmentsFromCsv(admin, DEMO_ACTION, MIXED_CSV);
    if ("error" in r) throw new Error(`inesperado: ${r.error}`);

    expect(r.imported).toBe(2); // Ana + Beca
    expect(r.failed).toEqual([]);
    // 2 filas rechazadas por el validador (sin nombre + DV malo)
    expect(new Set(r.report.errors.map((e) => e.rowNumber))).toEqual(new Set([2, 4]));

    // Se crearon las 2 inscripciones, con exención correcta.
    const { data: enr } = await svc
      .from("enrollments")
      .select("run, exento")
      .eq("action_id", DEMO_ACTION)
      .in("run", ["16032460-0", "9876543-3"]);
    expect(enr).toHaveLength(2);
    expect(enr!.find((x) => x.run === "9876543-3")?.exento).toBe(true);

    // NO se creó usuario para las filas inválidas.
    const { data: users } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
    const emails = users.users.map((u) => u.email?.toLowerCase());
    expect(emails).not.toContain("runmalo@otec.cl");
    expect(emails).not.toContain("sinnombre@otec.cl");
  });

  it("reimportar es idempotente: no duplica usuarios ni inscripciones", async () => {
    const before = await svc
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("action_id", DEMO_ACTION);

    const r = await importEnrollmentsFromCsv(admin, DEMO_ACTION, MIXED_CSV);
    if ("error" in r) throw new Error(`inesperado: ${r.error}`);
    expect(r.imported).toBe(2);

    const after = await svc
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("action_id", DEMO_ACTION);
    expect(after.count).toBe(before.count); // sin duplicados
  });

  it("persiste nombres/apellidos como snapshot en enrollments (task 2.4)", async () => {
    createdEmails.push("nombres.import@otec.cl");
    const csv =
      "nombre,apellidos,email,run,exento\n" +
      "Rosa,Fuentes Lagos,nombres.import@otec.cl,6786126-4,no\n";
    const r = await importEnrollmentsFromCsv(admin, DEMO_ACTION, csv);
    if ("error" in r) throw new Error(`inesperado: ${r.error}`);
    expect(r.imported).toBe(1);

    const { data } = await svc
      .from("enrollments")
      .select("first_names, last_names")
      .eq("action_id", DEMO_ACTION)
      .eq("run", "6786126-4")
      .single();
    expect(data).toEqual({ first_names: "Rosa", last_names: "Fuentes Lagos" });

    // Sin columna apellidos: first_names completo, last_names NULL (jamás partir).
    createdEmails.push("soloonombre.import@otec.cl");
    const r2 = await importEnrollmentsFromCsv(
      admin,
      DEMO_ACTION,
      "nombre,email,run\nPedro Pablo Rojas,soloonombre.import@otec.cl,1000005-k\n",
    );
    if ("error" in r2) throw new Error(`inesperado: ${r2.error}`);
    const { data: d2 } = await svc
      .from("enrollments")
      .select("first_names, last_names")
      .eq("action_id", DEMO_ACTION)
      .eq("run", "1000005-k")
      .single();
    expect(d2).toEqual({ first_names: "Pedro Pablo Rojas", last_names: null });
  });

  it("el alumno importado recibe rol student sin pisar roles existentes", async () => {
    const { data: users } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
    const ana = users.users.find((u) => u.email?.toLowerCase() === "ana.import@otec.cl");
    expect(ana).toBeDefined();
    const { data: mem } = await svc
      .from("memberships")
      .select("roles")
      .eq("tenant_id", TENANT_A)
      .eq("user_id", ana!.id)
      .single();
    expect(mem!.roles).toEqual(["student"]);
  });
});

describe("correo de bienvenida al inscribir (Hito 2, cierra follow-up de 1.6)", () => {
  const COURSE_URL = "https://seminarea.chilearning.cl/mi-curso";
  const WELCOME_CSV =
    "nombre,email,run,exento\n" +
    "Wanda Correo,welcome1@otec.cl,16032460-0,no\n" +
    "Walter Correo,welcome2@otec.cl,9876543-3,no\n";

  function fakeSender(outbox: OutgoingEmail[], ok = true): EmailSender {
    return {
      configured: true,
      async send(email) {
        outbox.push(email);
        return ok ? { ok: true, id: "fake" } : { ok: false, error: "resend_http_500" };
      },
    };
  }

  /** Acción fresca por test: las inscripciones siempre son NUEVAS. Debe estar
   * ACTIVA (con fechas) — solo se inscribe en acciones activas (task 2.8). */
  async function freshAction(): Promise<string> {
    const id = randomUUID();
    const { error } = await svc.from("actions").insert({
      id,
      tenant_id: TENANT_A,
      course_id: DEMO_COURSE,
      codigo_accion: "ACC-EMAIL-TEST",
      training_line: 3,
      environment: "rcetest",
      starts_on: "2026-07-01",
      ends_on: "2026-12-31",
      status: "active",
    });
    if (error) throw new Error(error.message);
    return id;
  }

  it("envía la bienvenida SOLO a inscripciones nuevas, con curso y guía Clave Única", async () => {
    createdEmails.push("welcome1@otec.cl", "welcome2@otec.cl");
    const actionId = await freshAction();
    const outbox: OutgoingEmail[] = [];

    const r = await importEnrollmentsFromCsv(admin, actionId, WELCOME_CSV, {
      emailSender: fakeSender(outbox),
      courseUrl: COURSE_URL,
    });
    if ("error" in r) throw new Error(`inesperado: ${r.error}`);

    expect(r.emails).toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(outbox.map((e) => e.to).sort()).toEqual(["welcome1@otec.cl", "welcome2@otec.cl"]);
    expect(outbox[0]?.subject).toContain("Bienvenido/a");
    expect(outbox[0]?.html).toContain(COURSE_URL);
    expect(outbox[0]?.html).toContain("Clave Única");

    // Auditoría del lote (P8): conteos, sin direcciones de correo.
    const { data: audits } = await svc
      .from("audit_log")
      .select("details")
      .eq("action", "email.welcome_batch")
      .eq("entity_id", actionId);
    expect(audits).toHaveLength(1);
    expect(audits?.[0]?.details).toEqual({ sent: 2, failed: 0, skipped: 0 });

    // Re-import idéntico: nada nuevo → ningún correo más.
    const again = await importEnrollmentsFromCsv(admin, actionId, WELCOME_CSV, {
      emailSender: fakeSender(outbox),
      courseUrl: COURSE_URL,
    });
    if ("error" in again) throw new Error(`inesperado: ${again.error}`);
    expect(again.emails).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(outbox).toHaveLength(2);
  });

  it("un envío fallido NO invalida la inscripción (best-effort)", async () => {
    const actionId = await freshAction();
    const outbox: OutgoingEmail[] = [];
    const r = await importEnrollmentsFromCsv(admin, actionId, WELCOME_CSV, {
      emailSender: fakeSender(outbox, false),
      courseUrl: COURSE_URL,
    });
    if ("error" in r) throw new Error(`inesperado: ${r.error}`);
    expect(r.imported).toBe(2);
    expect(r.emails).toEqual({ sent: 0, failed: 2, skipped: 0 });
  });

  it("sin proveedor configurado, las nuevas quedan como skipped (no revienta)", async () => {
    const actionId = await freshAction();
    const noop: EmailSender = {
      configured: false,
      async send() {
        throw new Error("no debería llamarse");
      },
    };
    const r = await importEnrollmentsFromCsv(admin, actionId, WELCOME_CSV, {
      emailSender: noop,
      courseUrl: COURSE_URL,
    });
    if ("error" in r) throw new Error(`inesperado: ${r.error}`);
    expect(r.imported).toBe(2);
    expect(r.emails).toEqual({ sent: 0, failed: 0, skipped: 2 });
  });
});
