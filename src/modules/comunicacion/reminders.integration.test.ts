/**
 * Integración del job de recordatorios (task 3.9) contra Supabase local. Verifica
 * el boundary RNF-10: a n8n SOLO va agregado seudonimizado (sin RUN/correo/nombre);
 * el correo PII va por EmailSender al destinatario real; el opt-out se honra; y hay
 * dedup diario (segunda corrida no reenvía). Requiere `db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { EmailSender, OutgoingEmail } from "@/modules/comunicacion/email-sender";
import type { N8nEmitter } from "@/modules/comunicacion/n8n-webhook";
import { pseudonymize, type N8nReminderEvent } from "@/modules/comunicacion/domain/automation";
import { runRemindersTick } from "@/modules/comunicacion/reminders";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
// Usuarios FRESCOS por corrida: la dedup diaria es por (kind, user); usuarios fijos
// harían el test no re-ejecutable el mismo día. Se crean en beforeAll.
let A = ""; // sin asistencia, sin opt-out → objetivo
let B = ""; // asistió hoy → NO objetivo
let C = ""; // sin asistencia, OPT-OUT → excluido

const RUN_A = "5126663-3";
const NAME_A = "Ana Pérez";
const EMAIL_A = "ana.perez@otec.cl";

let svc: SupabaseClient;
function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

const SECRET = "n8n-secret-abc";
let actionId = "";
const NOW = Date.parse("2026-07-16T15:00:00.000Z");

function captureSender(): { sender: EmailSender; sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return { sent, sender: { configured: true, async send(email) { sent.push(email); return { ok: true, id: "x" }; } } };
}
function captureN8n(): { n8n: N8nEmitter; events: N8nReminderEvent[] } {
  const events: N8nReminderEvent[] = [];
  return { events, n8n: { configured: true, async emit(e) { events.push(e); return { ok: true }; } } };
}
const resolve = async () => new Map([[A, { email: EMAIL_A, name: NAME_A }], [B, { email: "b@o.cl", name: "Beto" }], [C, { email: "c@o.cl", name: "Cata" }]]);

async function freshUser(): Promise<string> {
  const { data, error } = await svc.auth.admin.createUser({ email: `rem-${randomUUID().slice(0, 12)}@t.cl`, email_confirm: true, password: `Rm-${randomUUID()}` });
  if (error || !data?.user) throw new Error(`createUser: ${error?.message ?? "sin id"}`);
  return data.user.id;
}

beforeAll(async () => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });

  [A, B, C] = await Promise.all([freshUser(), freshUser(), freshUser()]);
  const courseId = randomUUID();
  await svc.from("courses").insert({ id: courseId, tenant_id: TENANT_A, name: "Curso 3.9", sence: true, cod_sence: "1234567890" });
  actionId = randomUUID();
  await svc.from("actions").insert({ id: actionId, tenant_id: TENANT_A, course_id: courseId, codigo_accion: `AUT-${randomUUID().slice(0, 6)}`, training_line: 3, environment: "rcetest" });

  const enr = await svc.from("enrollments").insert([
    { tenant_id: TENANT_A, action_id: actionId, user_id: A, run: RUN_A, first_names: "Ana", last_names: "Pérez" },
    { tenant_id: TENANT_A, action_id: actionId, user_id: B, run: "6222444-9", first_names: "Beto", last_names: "Soto" },
    { tenant_id: TENANT_A, action_id: actionId, user_id: C, run: "7333555-1", first_names: "Cata", last_names: "Vera" },
  ]).select("id, user_id");
  const enrBy = new Map((enr.data ?? []).map((r) => [r.user_id as string, r.id as string]));

  // B asistió hoy: sesión abierta hoy.
  const sess = await svc.from("sence_sessions").insert({
    tenant_id: TENANT_A, enrollment_id: enrBy.get(B), action_code: "AUT", training_line: 3, run_alumno: "6222444-9",
    id_sesion_alumno: `aut-${randomUUID()}`, id_sesion_sence: "998877", environment: "rcetest", status: "iniciada", opened_at: new Date(NOW).toISOString(),
  });
  if (sess.error) throw new Error(`seed session (enrB=${enrBy.get(B)}): ${sess.error.message}`);
  // C se dio de baja del correo.
  await svc.from("communication_opt_outs").insert({ tenant_id: TENANT_A, user_id: C, channel: "email" });
  // Config: recordatorio de asistencia habilitado.
  await svc.from("automation_config").upsert({ tenant_id: TENANT_A, action_id: actionId, kind: "no_attendance", enabled: true }, { onConflict: "action_id,kind" });
});

describe("recordatorios — RNF-10, correo PII, opt-out, dedup", () => {
  it("solo A recibe correo; n8n recibe agregado SIN PII; opt-out excluido; dedup en la 2ª corrida", async () => {
    const { sender, sent } = captureSender();
    const { n8n, events } = captureN8n();
    const summary = await runRemindersTick(svc, { now: NOW, secret: SECRET, emailSender: sender, n8n, resolveRecipients: resolve, appBaseUrl: "https://test.example/" });

    expect(summary.emailsSent).toBe(1);
    // El correo PII fue a A (destinatario real) con enlace ABSOLUTO (4-ojos MED).
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(EMAIL_A);
    expect(sent[0]!.html).toContain("https://test.example/mi-curso");

    // El evento a n8n: 1 destinatario (A), sin B (asistió) ni C (opt-out), y SIN PII.
    // El tick procesa TODA acción con config habilitada (reminders.ts:132), no solo
    // la de este test: otras suites dejan `no_attendance` habilitado en la acción
    // demo (automation.rls.test.ts) y sus inscritos sin asistencia emiten su propio
    // evento. Buscar "el primer no_attendance" hacía que la aserción cayera sobre el
    // evento de OTRA acción según el orden de archivos/estado de la BD; se ancla al
    // seudónimo de NUESTRA acción (mismo cómputo que el emisor, sin PII).
    const myAction = pseudonymize(SECRET, TENANT_A, actionId);
    const noAtt = events.find((e) => e.kind === "no_attendance" && e.action === myAction);
    expect(noAtt).toBeTruthy();
    expect(noAtt!.count).toBe(1);
    const json = JSON.stringify(noAtt);
    for (const pii of [RUN_A, EMAIL_A, NAME_A, A, "Ana", "Pérez"]) expect(json, `n8n filtró PII: ${pii}`).not.toContain(pii);

    // 2ª corrida el MISMO día → dedup: A ya recordado, 0 correos nuevos.
    const { sender: s2, sent: sent2 } = captureSender();
    const { n8n: n2 } = captureN8n();
    const again = await runRemindersTick(svc, { now: NOW, secret: SECRET, emailSender: s2, n8n: n2, resolveRecipients: resolve });
    expect(again.emailsSent).toBe(0);
    expect(sent2).toHaveLength(0);
  });
});
