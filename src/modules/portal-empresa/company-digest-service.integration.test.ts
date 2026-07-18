/**
 * Integración del digest semanal de empresa (task 5.9, HU-8.2) contra Supabase
 * local. Lo que fija:
 *  - fallback DETERMINÍSTICO (sin `aiClient` configurado) con los 6 conteos;
 *  - opt-out (`communication_opt_outs`, channel=email) excluye al destinatario;
 *  - miembro REVOCADO no recibe nada;
 *  - IDEMPOTENCIA: correr el tick 2 veces en la MISMA semana envía 1 sola vez
 *    (el ledger `company_weekly_digest_log` deduplica por `(tenant, company, week_start)`).
 *  - empresa SIN trabajadores vinculados -> se salta (nada que reportar).
 *
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { EmailSender, OutgoingEmail } from "@/modules/comunicacion/email-sender";
import { noopAiClient } from "@/modules/tutor-ia/ai-client";
import { runCompanyWeeklyDigestTick } from "@/modules/portal-empresa/company-digest-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-07-17T15:00:00.000Z"); // viernes de la semana del lunes 2026-07-13

let svc: SupabaseClient;
function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

function captureSender(): { sender: EmailSender; sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return { sent, sender: { configured: true, async send(email) { sent.push(email); return { ok: true, id: "x" }; } } };
}

async function freshUser(): Promise<string> {
  const { data, error } = await svc.auth.admin.createUser({
    email: `dig-${randomUUID().slice(0, 12)}@t.cl`, email_confirm: true, password: `Dg-${randomUUID()}`,
  });
  if (error || !data?.user) throw new Error(`createUser: ${error?.message ?? "sin id"}`);
  return data.user.id;
}

beforeAll(() => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
});

describe("runCompanyWeeklyDigestTick", () => {
  it("fallback determinístico + opt-out excluido + revocado excluido + idempotencia semanal", async () => {
    const companyId = randomUUID();
    await svc.from("companies").insert({
      id: companyId, tenant_id: TENANT_A, rut: `79${Math.floor(Math.random() * 900000 + 100000)}-0`,
      razon_social: "Pesquera Digest Ltda",
    });

    const [active, optedOut, revoked, workerUser] = await Promise.all([freshUser(), freshUser(), freshUser(), freshUser()]);
    await svc.from("company_members").insert([
      { tenant_id: TENANT_A, company_id: companyId, user_id: active, email: "rrhh.activa@t.cl" },
      { tenant_id: TENANT_A, company_id: companyId, user_id: optedOut, email: "rrhh.optout@t.cl" },
      { tenant_id: TENANT_A, company_id: companyId, user_id: revoked, email: "rrhh.revocada@t.cl", revoked_at: "2020-01-01T00:00:00.000Z" },
    ]);
    await svc.from("communication_opt_outs").insert({ tenant_id: TENANT_A, user_id: optedOut, channel: "email" });

    const courseId = randomUUID();
    await svc.from("courses").insert({ id: courseId, tenant_id: TENANT_A, name: "Curso digest 5.9", sence: false });
    const actionId = randomUUID();
    await svc.from("actions").insert({ id: actionId, tenant_id: TENANT_A, course_id: courseId, codigo_accion: `DIG-${randomUUID().slice(0, 6)}`, training_line: 3, environment: "rcetest" });
    await svc.from("enrollments").insert({
      id: randomUUID(), tenant_id: TENANT_A, action_id: actionId, user_id: workerUser,
      run: "5126663-3", first_names: "Trabajador", last_names: "Digest", company_id: companyId,
    });

    // El tick recorre TODAS las empresas de la instancia local (seed + otras
    // suites que dejan datos, `fileParallelism:false` no resetea entre
    // archivos) -- por eso las aserciones filtran por el correo de ESTE test
    // en vez de asumir conteos globales exactos (`summary.*` sí puede incluir
    // otras empresas reales del seed).
    const { sender, sent } = captureSender();
    const summary = await runCompanyWeeklyDigestTick(svc, { now: NOW, emailSender: sender, aiClient: noopAiClient(), appBaseUrl: "https://test.example/" });
    expect(summary.sent).toBeGreaterThanOrEqual(1);

    const mine = sent.filter((e) => e.to === "rrhh.activa@t.cl");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toContain("Pesquera Digest Ltda");
    // Narrativa DETERMINÍSTICA (aiClient no configurado): incluye los conteos reales.
    expect(mine[0]!.html).toContain("1 trabajador");
    expect(mine[0]!.html).toContain("1 acción");
    expect(mine[0]!.html).toContain("https://test.example/empresa");
    // Ni la opt-out ni la revocada recibieron nada.
    expect(sent.some((e) => e.to === "rrhh.optout@t.cl")).toBe(false);
    expect(sent.some((e) => e.to === "rrhh.revocada@t.cl")).toBe(false);

    // 2ª corrida, MISMA semana -> idempotente para ESTA empresa: 0 envíos nuevos.
    const { sender: s2, sent: sent2 } = captureSender();
    await runCompanyWeeklyDigestTick(svc, { now: NOW, emailSender: s2, aiClient: noopAiClient(), appBaseUrl: "https://test.example/" });
    expect(sent2.filter((e) => e.to === "rrhh.activa@t.cl")).toHaveLength(0);
  });

  it("empresa sin trabajadores vinculados -> se salta (nada que reportar)", async () => {
    const companyId = randomUUID();
    await svc.from("companies").insert({
      id: companyId, tenant_id: TENANT_A, rut: `78${Math.floor(Math.random() * 900000 + 100000)}-0`,
      razon_social: "Empresa Sin Trabajadores SpA",
    });
    const rrhh = await freshUser();
    await svc.from("company_members").insert({ tenant_id: TENANT_A, company_id: companyId, user_id: rrhh, email: "rrhh.vacia@t.cl" });

    const { sender, sent } = captureSender();
    // NOW distinto (otra semana) para no chocar con el ledger de la empresa del test anterior
    // (empresas distintas de todas formas, pero se usa una semana propia por prolijidad).
    const laterNow = Date.parse("2026-07-24T15:00:00.000Z");
    const summary = await runCompanyWeeklyDigestTick(svc, { now: laterNow, emailSender: sender, aiClient: noopAiClient(), appBaseUrl: "https://test.example/" });

    expect(sent.filter((e) => e.to === "rrhh.vacia@t.cl")).toHaveLength(0);
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
  });
});
