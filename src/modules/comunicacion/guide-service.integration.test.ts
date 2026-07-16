/**
 * Integración del envío de la guía Clave Única (task 2.7, HU-5.8) contra
 * Supabase local: envía SOLO a inscritos no exentos (sender fake — la API real
 * jamás se llama), audita el lote con conteos, respeta deny-by-default y
 * ofrece la marca manual sin proveedor.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { EmailSender, OutgoingEmail } from "@/modules/comunicacion/email-sender";
import { markGuideSent, sendClaveUnicaGuide } from "@/modules/comunicacion/guide-service";
import type { Principal } from "@/modules/core/domain/rbac";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
// Curso PROPIO del suite: inscribir usuarios seed en acciones del curso demo
// contamina los tests de progreso (asumen quién está inscrito en él).
let fixtureCourse = "";
const USER_TUTOR = "aaaaaaaa-0000-4000-8000-000000000004";
const USER_STUDENT = "aaaaaaaa-0000-4000-8000-000000000005";
const USER_COMPANY = "aaaaaaaa-0000-4000-8000-000000000006";
const ADMIN: Principal = {
  userId: "aaaaaaaa-0000-4000-8000-000000000001",
  tenantId: TENANT_A,
  roles: ["otec_admin"],
};

let svc: SupabaseClient;

function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => {
    const m = out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"));
    if (!m?.[1]) throw new Error(`falta ${k}`);
    return m[1];
  };
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

async function seedAction(): Promise<string> {
  const id = randomUUID();
  const { error } = await svc.from("actions").insert({
    id,
    tenant_id: TENANT_A,
    course_id: fixtureCourse,
    codigo_accion: "GUIA-2026-0715",
    training_line: 3,
    environment: "rcetest",
  });
  if (error) throw new Error(`seed acción: ${error.message}`);
  return id;
}

async function seedEnrollment(actionId: string, userId: string, exento = false): Promise<void> {
  const { error } = await svc.from("enrollments").insert({
    id: randomUUID(),
    tenant_id: TENANT_A,
    action_id: actionId,
    user_id: userId,
    run: "5126663-3",
    exento,
  });
  if (error) throw new Error(`seed inscripción: ${error.message}`);
}

function fakeSender(outbox: OutgoingEmail[]): EmailSender {
  return {
    configured: true,
    async send(email) {
      outbox.push(email);
      return { ok: true, id: "fake" };
    },
  };
}

beforeAll(async () => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
  fixtureCourse = randomUUID();
  const { error } = await svc.from("courses").insert({
    id: fixtureCourse,
    tenant_id: TENANT_A,
    name: "Curso guía CU",
    sence: true,
  });
  if (error) throw new Error(`seed curso: ${error.message}`);
});

describe("sendClaveUnicaGuide (HU-5.8)", () => {
  it("envía SOLO a los no exentos y audita el lote con conteos", async () => {
    const actionId = await seedAction();
    await seedEnrollment(actionId, USER_STUDENT);
    await seedEnrollment(actionId, USER_TUTOR);
    await seedEnrollment(actionId, USER_COMPANY, true); // exento: sin guía (I-14)

    const outbox: OutgoingEmail[] = [];
    const result = await sendClaveUnicaGuide(ADMIN, actionId, {
      emailSender: fakeSender(outbox),
      courseUrl: "https://seminarea.chilearning.cl/mi-curso",
    });
    if (!result.ok) throw new Error(result.error);

    expect(result.summary).toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(outbox).toHaveLength(2);
    expect(outbox[0]?.html).toContain("Clave Única");
    expect(outbox[0]?.html).toContain("https://seminarea.chilearning.cl/mi-curso");

    const { data: audits } = await svc
      .from("audit_log")
      .select("action, details")
      .eq("entity_id", actionId)
      .eq("action", "sence.guide_sent");
    expect(audits).toHaveLength(1);
    expect(audits?.[0]?.details).toEqual({ sent: 2, failed: 0, skipped: 0 });
  });

  it("sin proveedor configurado → not_configured; la marca MANUAL queda auditada", async () => {
    const actionId = await seedAction();
    await seedEnrollment(actionId, USER_STUDENT);

    const noop: EmailSender = {
      configured: false,
      async send() {
        throw new Error("no debería llamarse");
      },
    };
    expect(
      await sendClaveUnicaGuide(ADMIN, actionId, {
        emailSender: noop,
        courseUrl: "https://x.cl/mi-curso",
      }),
    ).toEqual({ ok: false, error: "not_configured" });

    expect(await markGuideSent(ADMIN, actionId)).toEqual({ ok: true });
    const { data: audits } = await svc
      .from("audit_log")
      .select("action")
      .eq("entity_id", actionId)
      .eq("action", "sence.guide_marked_sent");
    expect(audits).toHaveLength(1);
  });

  it("un student no puede enviar ni marcar (deny-by-default); acción ajena = not_found", async () => {
    const actionId = await seedAction();
    const student: Principal = { userId: USER_STUDENT, tenantId: TENANT_A, roles: ["student"] };
    expect(
      await sendClaveUnicaGuide(student, actionId, { courseUrl: "https://x.cl" }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await markGuideSent(student, actionId)).toEqual({ ok: false, error: "forbidden" });

    const otherAdmin: Principal = {
      userId: "bbbbbbbb-0000-4000-8000-000000000001",
      tenantId: "22222222-2222-4222-8222-222222222222",
      roles: ["otec_admin"],
    };
    expect(await markGuideSent(otherAdmin, actionId)).toEqual({ ok: false, error: "not_found" });
  });
});
