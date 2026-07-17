/**
 * Integración de vigencia + alertas de recertificación (task 5.12, HU-7.3)
 * contra Supabase local. Lo que fija:
 *  - emitir en un curso con `validity_months` ⇒ `expires_at` = emisión + N meses
 *    (y curso sin vigencia ⇒ null);
 *  - el tick notifica UNA vez por (certificado, offset) — 2ª corrida = 0 (dedup);
 *  - la regla ANTI-RÁFAGA: entrar tarde a la ventana marca los offsets mayores
 *    sin notificarlos y manda UN solo aviso;
 *  - `enabled = false` apaga el tenant;
 *  - a n8n va agregado seudonimizado SIN PII (RNF-10).
 *
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issueCertificate } from "@/modules/certificados/certificates-service";
import { runExpiryAlertsTick } from "@/modules/certificados/expiry-alerts";
import type { Principal } from "@/modules/core/domain/rbac";
import type { EmailSender, OutgoingEmail } from "@/modules/comunicacion/email-sender";
import type { N8nEventBase } from "@/modules/comunicacion/domain/automation";
import type { N8nEmitter } from "@/modules/comunicacion/n8n-webhook";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const admin: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };

const DAY_MS = 24 * 60 * 60 * 1000;
const SECRET = "expiry-secret-xyz";
const NOW = Date.parse("2026-07-17T12:00:00.000Z");

// Datos FICTICIOS (regla dura del proyecto).
const RUN_A = "5126663-3";
const EMAIL_A = "ana.silva@ejemplo.cl";
const NAME_A = "Ana Silva";

let svc: SupabaseClient;
let studentUser = "";
/** Todo lo sembrado por esta suite, para limpiarlo en afterAll. */
const seeded = { courses: [] as string[], actions: [] as string[], enrollments: [] as string[], users: [] as string[] };

function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

function captureSender(): { sender: EmailSender; sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return { sent, sender: { configured: true, async send(email) { sent.push(email); return { ok: true, id: "x" }; } } };
}
function captureN8n(): { n8n: N8nEmitter; events: N8nEventBase[] } {
  const events: N8nEventBase[] = [];
  return { events, n8n: { configured: true, async emit(e) { events.push(e); return { ok: true }; } } };
}

async function freshUser(): Promise<string> {
  const { data, error } = await svc.auth.admin.createUser({
    email: `exp-${randomUUID().slice(0, 12)}@t.cl`, email_confirm: true, password: `Ex-${randomUUID()}`,
  });
  if (error || !data?.user) throw new Error(`createUser: ${error?.message ?? "sin id"}`);
  seeded.users.push(data.user.id);
  return data.user.id;
}

/** Curso + acción + inscripción listos para emitir (sin reglas que bloqueen). */
async function makeEnrollment(opts: { validityMonths: number | null; userId: string; tenantId?: string }): Promise<{
  courseId: string; actionId: string; enrollmentId: string;
}> {
  const tenantId = opts.tenantId ?? TENANT_A;
  const courseId = randomUUID();
  await svc.from("courses").insert({
    id: courseId, tenant_id: tenantId, name: "Curso 5.12 vigencia", sence: false, hours: 8,
    // Sin exigencias: la elegibilidad no es lo que prueba esta suite (eso ya lo
    // cubre certificates-service.integration).
    completion_rules: { requireAllLessons: false, requireSurvey: false, minAttendancePct: 0, minGrade: 4.0 },
    validity_months: opts.validityMonths,
  });
  seeded.courses.push(courseId);

  const actionId = randomUUID();
  await svc.from("actions").insert({
    id: actionId, tenant_id: tenantId, course_id: courseId, codigo_accion: `EXP-${randomUUID().slice(0, 6)}`,
    training_line: 3, environment: "rcetest",
  });
  seeded.actions.push(actionId);

  const enrollmentId = randomUUID();
  await svc.from("enrollments").insert({
    id: enrollmentId, tenant_id: tenantId, action_id: actionId, user_id: opts.userId,
    run: RUN_A, exento: false, first_names: "Ana", last_names: "Silva",
  });
  seeded.enrollments.push(enrollmentId);
  return { courseId, actionId, enrollmentId };
}

/** Emite y fuerza el `expires_at` a `daysFromNow` (para no esperar 12 meses). */
async function issueExpiringIn(daysFromNow: number, userId: string): Promise<{ certId: string; courseId: string }> {
  const { enrollmentId, courseId } = await makeEnrollment({ validityMonths: 12, userId });
  const res = await issueCertificate(admin, enrollmentId);
  if (!res.ok) throw new Error(`no se pudo emitir: ${res.error}`);
  // `expires_at` es columna, NO parte del snapshot: se puede corregir sin chocar
  // con el trigger de inmutabilidad (D-112). Justo por eso vive fuera.
  const upd = await svc.from("certificates")
    .update({ expires_at: new Date(NOW + daysFromNow * DAY_MS).toISOString() })
    .eq("id", res.certificateId);
  if (upd.error) throw new Error(`no se pudo fijar expires_at: ${upd.error.message}`);
  return { certId: res.certificateId, courseId };
}

const resolve = async (): Promise<Map<string, { email: string; name: string }>> =>
  new Map([[studentUser, { email: EMAIL_A, name: NAME_A }]]);

async function tick(overrides?: Partial<Parameters<typeof runExpiryAlertsTick>[1]>) {
  const { sender, sent } = captureSender();
  const { n8n, events } = captureN8n();
  const summary = await runExpiryAlertsTick(svc, {
    now: NOW, secret: SECRET, emailSender: sender, n8n, resolveRecipients: resolve,
    appBaseUrl: "https://test.example/", ...overrides,
  });
  return { summary, sent, events };
}

/**
 * Config del tenant. `null` = borrar la fila (volver a los defaults).
 *
 * ⚠ NO ignora el error a propósito: la primera versión de esta suite hacía
 * `delete` sin mirar el resultado y, al no existir el grant de DELETE para el
 * service_role, el borrado fallaba en SILENCIO. El residuo (`offsets_days = {15}`)
 * encogía la ventana del job y hacía fallar a los tests SIGUIENTES, lejos de la
 * causa. Si un día se vuelve a quitar el grant, esto revienta aquí y no allá.
 */
async function setConfig(tenantId: string, cfg: { offsets: number[]; enabled: boolean } | null): Promise<void> {
  const { error } = cfg
    ? await svc.from("certificate_expiry_config").upsert(
        { tenant_id: tenantId, enabled: cfg.enabled, offsets_days: cfg.offsets },
        { onConflict: "tenant_id" },
      )
    : await svc.from("certificate_expiry_config").delete().eq("tenant_id", tenantId);
  if (error) throw new Error(`config ${cfg ? "upsert" : "delete"} (${tenantId}): ${error.message}`);
}

async function alertsOf(certId: string): Promise<number[]> {
  const { data } = await svc.from("certificate_expiry_alerts").select("offset_days").eq("certificate_id", certId);
  return (data ?? []).map((r) => r.offset_days as number).sort((a, b) => b - a);
}
async function notificationsOf(certId: string): Promise<number> {
  // Filtra por `certificate_id` en el SERVIDOR (no en cliente tras traer todo):
  // `notifications` no tiene DELETE para service_role (es outbox), así que su
  // residuo crece entre corridas; un select global sin acotar es frágil.
  const { data } = await svc
    .from("notifications")
    .select("id")
    .eq("kind", "certificate.expiring")
    .eq("payload->>certificateId", certId);
  return (data ?? []).length;
}

beforeAll(async () => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
  studentUser = await freshUser();

  // El tenant B queda EXPLÍCITAMENTE apagado: así ningún certificado suyo (de
  // esta u otra suite) emite avisos y los conteos de abajo son estables.
  await setConfig(TENANT_B, { offsets: [90, 60, 30], enabled: false });
  // Y el A entra LIMPIO (sin fila = defaults): si una corrida anterior murió a
  // mitad y dejó config, la ventana del job no sería la que estos tests asumen.
  await setConfig(TENANT_A, null);
});

afterAll(async () => {
  // Limpieza de lo sembrado: otras suites afirman sobre listas completas y el
  // residuo las rompe según el orden de archivos. `certificates`,
  // `certificate_expiry_alerts` y `notifications` NO tienen DELETE para el
  // service_role (son ledgers, por diseño): su residuo es INERTE porque cuelga
  // de ids ALEATORIOS por corrida y ninguna aserción de esta suite —ni de otra—
  // cuenta filas globales de esas tablas (se filtra siempre por certificate_id).
  // Por la FK `restrict` de certificates, las inscripciones/acciones/cursos con
  // certificado tampoco se pueden borrar; se intenta y se ignora el fallo.
  try {
    for (const id of seeded.enrollments) await svc.from("enrollments").delete().eq("id", id);
    for (const id of seeded.actions) await svc.from("actions").delete().eq("id", id);
    for (const id of seeded.courses) await svc.from("courses").delete().eq("id", id);
  } finally {
    await setConfig(TENANT_B, null);
    await setConfig(TENANT_A, null);
  }
});

describe("vigencia en la emisión", () => {
  it("★ curso con validity_months = 12 ⇒ expires_at = emisión + 12 meses", async () => {
    const { enrollmentId } = await makeEnrollment({ validityMonths: 12, userId: await freshUser() });
    const res = await issueCertificate(admin, enrollmentId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { data } = await svc.from("certificates").select("issued_at, expires_at, snapshot").eq("id", res.certificateId).single();
    expect(data!.expires_at).not.toBeNull();

    // +12 meses exactos sobre el instante de emisión (mismo día y hora).
    const issued = new Date(data!.issued_at as string);
    const expires = new Date(data!.expires_at as string);
    expect(expires.getUTCFullYear()).toBe(issued.getUTCFullYear() + 1);
    expect(expires.getUTCMonth()).toBe(issued.getUTCMonth());

    // ★ La vigencia NO entra al snapshot: es metadato operativo, y el snapshot
    // es el documento legal congelado (D-112).
    expect(JSON.stringify(data!.snapshot)).not.toContain("expires");
  });

  it("curso SIN vigencia ⇒ expires_at null (el default: no vence)", async () => {
    const { enrollmentId } = await makeEnrollment({ validityMonths: null, userId: await freshUser() });
    const res = await issueCertificate(admin, enrollmentId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { data } = await svc.from("certificates").select("expires_at").eq("id", res.certificateId).single();
    expect(data!.expires_at).toBeNull();
  });
});

describe("tick de alertas", () => {
  it("★ cert a 89 días ⇒ ledger {90} + 1 aviso + correo; 2ª corrida ⇒ 0 (dedup)", async () => {
    const { certId } = await issueExpiringIn(89, studentUser);

    const first = await tick();
    expect(await alertsOf(certId)).toEqual([90]);
    expect(await notificationsOf(certId)).toBe(1);
    // El correo PII fue al destinatario real, con enlace ABSOLUTO.
    const mine = first.sent.filter((s) => s.to === EMAIL_A);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine[0]!.html).toContain("https://test.example/mi-curso/certificados");

    // 2ª corrida: el unique (certificate_id, offset_days) es la idempotencia.
    const second = await tick();
    expect(await alertsOf(certId)).toEqual([90]);
    expect(await notificationsOf(certId)).toBe(1);
    expect(second.sent.filter((s) => s.to === EMAIL_A)).toHaveLength(0);
  });

  it("★ ANTI-RÁFAGA: entra a 45 días ⇒ ledger {90,60} pero UNA sola notificación (offset 60)", async () => {
    const user = await freshUser();
    const { certId } = await issueExpiringIn(45, user);
    const resolveThis = async (): Promise<Map<string, { email: string; name: string }>> =>
      new Map([[user, { email: "burst@ejemplo.cl", name: "Bruno Ráfaga" }]]);

    const { sent } = await tick({ resolveRecipients: resolveThis });

    // El 90 se marca SIN notificar: su momento ya pasó. Sin esto, el alumno
    // recibiría 90, 60 y 30 en tres ticks seguidos por un hecho único.
    expect(await alertsOf(certId)).toEqual([90, 60]);
    expect(await notificationsOf(certId)).toBe(1);
    expect(sent.filter((s) => s.to === "burst@ejemplo.cl")).toHaveLength(1);

    const { data } = await svc.from("notifications").select("payload").eq("kind", "certificate.expiring");
    const mine = (data ?? []).find((n) => (n.payload as { certificateId?: string })?.certificateId === certId);
    expect((mine!.payload as { offsetDays: number }).offsetDays).toBe(60);
  });

  it("cert a 91 días ⇒ fuera de la ventana: 0 avisos", async () => {
    const { certId } = await issueExpiringIn(91, await freshUser());
    await tick();
    expect(await alertsOf(certId)).toEqual([]);
    expect(await notificationsOf(certId)).toBe(0);
  });

  it("★ cert YA VENCIDO ⇒ 0 avisos (no se spamea a quien ya perdió la vigencia)", async () => {
    const { certId } = await issueExpiringIn(-5, await freshUser());
    await tick();
    expect(await alertsOf(certId)).toEqual([]);
    expect(await notificationsOf(certId)).toBe(0);
  });

  it("★ config enabled = false ⇒ 0 avisos para todo el tenant", async () => {
    const { certId } = await issueExpiringIn(29, await freshUser());
    await setConfig(TENANT_A, { offsets: [90, 60, 30], enabled: false });
    try {
      const { summary } = await tick();
      expect(summary.tenants).toBe(0);
      expect(await alertsOf(certId)).toEqual([]);
      expect(await notificationsOf(certId)).toBe(0);
    } finally {
      await setConfig(TENANT_A, null);
    }
    // Y con la config de vuelta (sin fila = defaults habilitados), sí avisa.
    await tick();
    expect(await alertsOf(certId)).toEqual([90, 60, 30]);
    expect(await notificationsOf(certId)).toBe(1);
  });

  it("offsets configurados a medida mandan sobre el default 90/60/30", async () => {
    const { certId } = await issueExpiringIn(14, await freshUser());
    await setConfig(TENANT_A, { offsets: [15], enabled: true });
    try {
      await tick();
      expect(await alertsOf(certId)).toEqual([15]);
    } finally {
      await setConfig(TENANT_A, null);
    }
  });

  it("opt-out del canal email ⇒ aviso in-app SÍ, correo NO (Ley 21.719)", async () => {
    const user = await freshUser();
    const { certId } = await issueExpiringIn(30, user);
    await svc.from("communication_opt_outs").insert({ tenant_id: TENANT_A, user_id: user, channel: "email" });
    const resolveThis = async (): Promise<Map<string, { email: string; name: string }>> =>
      new Map([[user, { email: "optout@ejemplo.cl", name: "Olga Baja" }]]);

    const { sent } = await tick({ resolveRecipients: resolveThis });
    expect(await notificationsOf(certId)).toBe(1);
    expect(sent.filter((s) => s.to === "optout@ejemplo.cl")).toHaveLength(0);
  });

  it("★ n8n recibe el agregado SIN PII y sin ids reales (RNF-10)", async () => {
    const user = await freshUser();
    const { certId, courseId } = await issueExpiringIn(30, user);
    const resolveThis = async (): Promise<Map<string, { email: string; name: string }>> =>
      new Map([[user, { email: EMAIL_A, name: NAME_A }]]);

    const { events } = await tick({ resolveRecipients: resolveThis });
    const mine = events.filter((e) => e.type === "certificate_expiring");
    expect(mine.length).toBeGreaterThanOrEqual(1);

    const json = JSON.stringify(mine);
    for (const pii of [RUN_A, EMAIL_A, NAME_A, "Ana", "Silva", user, certId, courseId, TENANT_A]) {
      expect(json, `n8n filtró PII/id real: ${pii}`).not.toContain(pii);
    }
  });
});
