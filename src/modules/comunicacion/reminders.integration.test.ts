/**
 * Integración del job de recordatorios (task 3.9) contra Supabase local. Verifica
 * el boundary RNF-10: a n8n SOLO va agregado seudonimizado (sin RUN/correo/nombre);
 * el correo PII va por EmailSender al destinatario real; el opt-out se honra; y hay
 * dedup diario (segunda corrida no reenvía). Requiere `db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EmailSender, OutgoingEmail } from "@/modules/comunicacion/email-sender";
import type { N8nEmitter } from "@/modules/comunicacion/n8n-webhook";
import { pseudonymize, type N8nEventBase, type N8nReminderEvent } from "@/modules/comunicacion/domain/automation";
import { runRemindersTick } from "@/modules/comunicacion/reminders";
import { noopWhatsAppSender, type OutgoingWhatsApp, type WhatsAppSender } from "@/modules/comunicacion/whatsapp-sender";

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
/** El emisor acepta cualquier `N8nEventBase` (task 5.12 sumó el de vencimientos),
 *  así que se captura la base y se estrecha a `reminder` al afirmar. */
function isReminderEvent(e: N8nEventBase): e is N8nReminderEvent {
  return e.type === "reminder";
}
function captureN8n(): { n8n: N8nEmitter; events: N8nEventBase[] } {
  const events: N8nEventBase[] = [];
  return { events, n8n: { configured: true, async emit(e) { events.push(e); return { ok: true }; } } };
}
function captureWhatsApp(): { sender: WhatsAppSender; sent: OutgoingWhatsApp[] } {
  const sent: OutgoingWhatsApp[] = [];
  return { sent, sender: { configured: true, async send(msg) { sent.push(msg); return { ok: true, id: "wamid.x" }; } } };
}
const resolve = async () =>
  new Map([
    [A, { email: EMAIL_A, name: NAME_A, phone: null }],
    [B, { email: "b@o.cl", name: "Beto", phone: null }],
    [C, { email: "c@o.cl", name: "Cata", phone: null }],
  ]);

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
  it("solo A recibe correo (C está opt-out de EMAIL, pero cuenta igual para n8n); n8n recibe agregado SIN PII; dedup en la 2ª corrida", async () => {
    const { sender, sent } = captureSender();
    const { n8n, events } = captureN8n();
    const summary = await runRemindersTick(svc, { now: NOW, secret: SECRET, emailSender: sender, whatsappSender: noopWhatsAppSender(), n8n, resolveRecipients: resolve, appBaseUrl: "https://test.example/" });

    expect(summary.emailsSent).toBe(1);
    // El correo PII fue a A (destinatario real) con enlace ABSOLUTO (4-ojos MED).
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(EMAIL_A);
    expect(sent[0]!.html).toContain("https://test.example/mi-curso");

    // El evento a n8n: 2 destinatarios (A y C — ambos sin asistencia hoy), sin
    // B (asistió), y SIN PII. C SÍ sigue contando aquí aunque esté opt-out de
    // EMAIL (fix task 5.11, revisión adversarial): el opt-out se filtra POR
    // CANAL dentro de `dispatch()`, no en la selección de `targets` — por eso
    // C es "candidato evaluado hoy" (mismo criterio que ya aplicaba: un
    // `emailSender` no configurado tampoco restaba del count) pero NO recibe
    // el correo (verificado arriba: `sent` solo tiene 1 elemento, el de A) ni
    // WhatsApp (sin teléfono; sender no-op en este test). El tick procesa TODA
    // acción con config habilitada (reminders.ts:132), no solo la de este
    // test: otras suites dejan `no_attendance` habilitado en la acción demo
    // (automation.rls.test.ts) y sus inscritos sin asistencia emiten su propio
    // evento. Buscar "el primer no_attendance" hacía que la aserción cayera
    // sobre el evento de OTRA acción según el orden de archivos/estado de la
    // BD; se ancla al seudónimo de NUESTRA acción (mismo cómputo que el
    // emisor, sin PII).
    const myAction = pseudonymize(SECRET, TENANT_A, actionId);
    const noAtt = events.filter(isReminderEvent).find((e) => e.kind === "no_attendance" && e.action === myAction);
    expect(noAtt).toBeTruthy();
    expect(noAtt!.count).toBe(2);
    const json = JSON.stringify(noAtt);
    for (const pii of [RUN_A, EMAIL_A, NAME_A, A, "Ana", "Pérez", C]) expect(json, `n8n filtró PII: ${pii}`).not.toContain(pii);

    // 2ª corrida el MISMO día → dedup: A ya recordado, 0 correos nuevos.
    const { sender: s2, sent: sent2 } = captureSender();
    const { n8n: n2 } = captureN8n();
    const again = await runRemindersTick(svc, { now: NOW, secret: SECRET, emailSender: s2, whatsappSender: noopWhatsAppSender(), n8n: n2, resolveRecipients: resolve });
    expect(again.emailsSent).toBe(0);
    expect(sent2).toHaveLength(0);
  });
});

describe("WhatsApp (task 5.11, D-049): flag de tenant + teléfono + opt-out independiente del de email", () => {
  let waActionId = "";
  const COURSE_NAME = "Curso WhatsApp 5.11";
  // Otro instante del MISMO día que NOW: cada `it` usa su propio alumno fresco,
  // así que la dedup diaria no interfiere entre los tres casos de este bloque.
  const NOW2 = Date.parse("2026-07-16T16:00:00.000Z");

  beforeAll(async () => {
    const courseId = randomUUID();
    await svc.from("courses").insert({ id: courseId, tenant_id: TENANT_A, name: COURSE_NAME, sence: true, cod_sence: "1234567891" });
    waActionId = randomUUID();
    await svc.from("actions").insert({ id: waActionId, tenant_id: TENANT_A, course_id: courseId, codigo_accion: `WA-${randomUUID().slice(0, 6)}`, training_line: 3, environment: "rcetest" });
    await svc.from("automation_config").upsert({ tenant_id: TENANT_A, action_id: waActionId, kind: "no_attendance", enabled: true }, { onConflict: "action_id,kind" });
  });

  afterAll(async () => {
    // Deja el flag como estaba por defecto para no afectar otras suites de integración.
    await svc.from("tenants").update({ flags: {} }).eq("id", TENANT_A);
  });

  async function enrollFreshStudent(run: string): Promise<string> {
    const userId = await freshUser();
    await svc.from("enrollments").insert({ tenant_id: TENANT_A, action_id: waActionId, user_id: userId, run, first_names: "X", last_names: "Y" });
    return userId;
  }

  it("con el flag 'whatsapp' apagado (default): NO envía por WhatsApp aunque haya teléfono", async () => {
    await svc.from("tenants").update({ flags: {} }).eq("id", TENANT_A);
    const userId = await enrollFreshStudent("1111111-1");
    const resolveOne = async () => new Map([[userId, { email: "xavier@o.cl", name: "Xavier Soto", phone: "+56911112222" }]]);
    const { sender, sent } = captureSender();
    const { n8n } = captureN8n();
    const { sender: wa, sent: waSent } = captureWhatsApp();

    const summary = await runRemindersTick(svc, { now: NOW2, secret: SECRET, emailSender: sender, whatsappSender: wa, n8n, resolveRecipients: resolveOne });

    expect(summary.whatsappSent).toBe(0);
    expect(waSent).toHaveLength(0);
    // El correo NO depende del flag whatsapp: se sigue enviando igual.
    expect(sent).toHaveLength(1);
  });

  it("con el flag encendido y teléfono: envía la plantilla recordatorio_asistencia_v1 con [firstName, curso]", async () => {
    await svc.from("tenants").update({ flags: { whatsapp: true } }).eq("id", TENANT_A);
    const userId = await enrollFreshStudent("2222222-2");
    const resolveOne = async () => new Map([[userId, { email: "yolanda@o.cl", name: "Yolanda Reyes", phone: "+56933334444" }]]);
    const { sender } = captureSender();
    const { n8n } = captureN8n();
    const { sender: wa, sent: waSent } = captureWhatsApp();

    const summary = await runRemindersTick(svc, { now: NOW2 + 1000, secret: SECRET, emailSender: sender, whatsappSender: wa, n8n, resolveRecipients: resolveOne });

    expect(summary.whatsappSent).toBe(1);
    expect(waSent).toHaveLength(1);
    expect(waSent[0]!.to).toBe("+56933334444");
    expect(waSent[0]!.templateName).toBe("recordatorio_asistencia_v1");
    expect(waSent[0]!.languageCode).toBe("es");
    // Solo primer nombre — nunca el apellido (minimización RNF-10).
    expect(waSent[0]!.bodyParams).toEqual(["Yolanda", COURSE_NAME]);
  });

  it("opt-out SOLO de WhatsApp: no recibe el canal, pero SÍ sigue recibiendo correo (canales independientes)", async () => {
    await svc.from("tenants").update({ flags: { whatsapp: true } }).eq("id", TENANT_A);
    const userId = await enrollFreshStudent("3333333-3");
    await svc.from("communication_opt_outs").insert({ tenant_id: TENANT_A, user_id: userId, channel: "whatsapp" });
    const resolveOne = async () => new Map([[userId, { email: "zoe@o.cl", name: "Zoe Vidal", phone: "+56955556666" }]]);
    const { sender, sent } = captureSender();
    const { n8n } = captureN8n();
    const { sender: wa, sent: waSent } = captureWhatsApp();

    const summary = await runRemindersTick(svc, { now: NOW2 + 2000, secret: SECRET, emailSender: sender, whatsappSender: wa, n8n, resolveRecipients: resolveOne });

    expect(summary.whatsappSent).toBe(0);
    expect(waSent).toHaveLength(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("zoe@o.cl");
  });

  it("opt-out SOLO de email: no recibe el correo, pero SÍ sigue recibiendo WhatsApp (dirección inversa — bug real cazado por revisión adversarial, ya corregido)", async () => {
    await svc.from("tenants").update({ flags: { whatsapp: true } }).eq("id", TENANT_A);
    const userId = await enrollFreshStudent("4444444-4");
    await svc.from("communication_opt_outs").insert({ tenant_id: TENANT_A, user_id: userId, channel: "email" });
    const resolveOne = async () => new Map([[userId, { email: "walter@o.cl", name: "Walter Diaz", phone: "+56977778888" }]]);
    const { sender, sent } = captureSender();
    const { n8n } = captureN8n();
    const { sender: wa, sent: waSent } = captureWhatsApp();

    const summary = await runRemindersTick(svc, { now: NOW2 + 3000, secret: SECRET, emailSender: sender, whatsappSender: wa, n8n, resolveRecipients: resolveOne });

    // Antes del fix, `selectNoAttendance` excluía a este alumno de `targets`
    // por su opt-out de EMAIL, así que el bloque WhatsApp nunca se evaluaba
    // para él: se quedaba sin WhatsApp aunque nunca se hubiera dado de baja
    // de ESE canal. Ahora el opt-out se filtra POR CANAL dentro de dispatch().
    expect(summary.emailsSent).toBe(0);
    expect(sent).toHaveLength(0);
    expect(summary.whatsappSent).toBe(1);
    expect(waSent).toHaveLength(1);
    expect(waSent[0]!.to).toBe("+56977778888");
  });
});
