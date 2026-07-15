/**
 * Integración de certificados (task 3.2) contra Supabase local: elegibilidad
 * (reusa gradebook + cumplimiento + progreso + encuesta), emisión atómica (RPC
 * con folio + PDF en bucket), verificación pública por token (RUN enmascarado),
 * revocación y re-emisión. Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "@/modules/core/domain/rbac";
import {
  getActionEligibility,
  issueBatch,
  issueCertificate,
  revokeCertificate,
  verifyCertificate,
} from "@/modules/certificados/certificates-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const USER_STUDENT = "aaaaaaaa-0000-4000-8000-000000000005";
const admin: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };
const student: Principal = { userId: USER_STUDENT, tenantId: TENANT_A, roles: ["student"] };

let svc: SupabaseClient;

function env(): { apiUrl: string; serviceRoleKey: string; anonKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY"), anonKey: get("ANON_KEY") };
}

interface Rules { requireAllLessons: boolean; requireSurvey: boolean; minAttendancePct: number }

async function makeAction(opts: {
  rules: Rules; sence: boolean; override?: number | null; dates?: [string, string];
}): Promise<{ courseId: string; actionId: string; enrollmentId: string }> {
  const courseId = randomUUID();
  await svc.from("courses").insert({
    id: courseId, tenant_id: TENANT_A, name: "Curso cert", sence: opts.sence,
    cod_sence: opts.sence ? "1234567890" : null,
    completion_rules: { ...opts.rules, minGrade: 4.0 },
  });
  const actionId = randomUUID();
  const [startsOn, endsOn] = opts.dates ?? [null, null] as unknown as [string, string];
  await svc.from("actions").insert({
    id: actionId, tenant_id: TENANT_A, course_id: courseId, codigo_accion: `CERT-${randomUUID().slice(0, 6)}`,
    training_line: 3, environment: "rcetest", starts_on: startsOn, ends_on: endsOn,
    min_attendance_pct_override: opts.override ?? null,
  });
  const enrollmentId = randomUUID();
  await svc.from("enrollments").insert({
    id: enrollmentId, tenant_id: TENANT_A, action_id: actionId, user_id: USER_STUDENT,
    run: "5126663-3", exento: false, first_names: "Ana", last_names: "Díaz",
  });
  return { courseId, actionId, enrollmentId };
}

beforeAll(() => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = e.anonKey;
  process.env.TENANT_ROOT_DOMAIN = "localtest.me";
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
});

describe("emisión + verificación pública + revocación", () => {
  it("emite a un alumno elegible, verifica por token (RUN enmascarado) y revoca", async () => {
    const { actionId, enrollmentId } = await makeAction({ rules: { requireAllLessons: false, requireSurvey: false, minAttendancePct: 0 }, sence: false });

    const elig = await getActionEligibility(admin, actionId);
    expect(elig).not.toBeNull();
    const row = elig!.rows.find((r) => r.enrollmentId === enrollmentId)!;
    expect(row.eligible).toBe(true);

    const issued = await issueCertificate(admin, enrollmentId);
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.folio).toMatch(/^CERT-\d{4}-\d{6}$/);

    // Segundo intento → already_issued.
    const again = await issueCertificate(admin, enrollmentId);
    expect(again.ok).toBe(false);

    // Verificación pública por token.
    const { data: cert } = await svc.from("certificates").select("verification_token").eq("id", issued.certificateId).maybeSingle();
    const token = cert!.verification_token as string;
    const verified = await verifyCertificate(token);
    expect(verified).not.toBeNull();
    expect(verified!.status).toBe("issued");
    expect(verified!.runMasked).toBe("51.XXX.XXX-X");
    expect(verified!.folio).toBe(issued.folio);

    // Revocar → verificación muestra revocado + motivo.
    const rev = await revokeCertificate(admin, issued.certificateId, "Error en los datos");
    expect(rev.ok).toBe(true);
    const afterRevoke = await verifyCertificate(token);
    expect(afterRevoke!.status).toBe("revoked");
    expect(afterRevoke!.revokedReason).toBe("Error en los datos");

    // Tras revocar se puede re-emitir (nuevo certificado vigente).
    const reissued = await issueCertificate(admin, enrollmentId);
    expect(reissued.ok).toBe(true);
  });

  it("el motivo de revocación es obligatorio", async () => {
    const { actionId, enrollmentId } = await makeAction({ rules: { requireAllLessons: false, requireSurvey: false, minAttendancePct: 0 }, sence: false });
    await getActionEligibility(admin, actionId);
    const issued = await issueCertificate(admin, enrollmentId);
    if (!issued.ok) return;
    const rev = await revokeCertificate(admin, issued.certificateId, "   ");
    expect(rev.ok).toBe(false);
  });
});

describe("gate de elegibilidad", () => {
  it("bloquea si la encuesta requerida está pendiente", async () => {
    const { courseId, actionId, enrollmentId } = await makeAction({ rules: { requireAllLessons: false, requireSurvey: true, minAttendancePct: 0 }, sence: false });
    // Encuesta publicada, sin responder.
    await svc.from("surveys").insert({ tenant_id: TENANT_A, course_id: courseId, title: "Enc", status: "published", questions: { questions: [] } });

    const elig = await getActionEligibility(admin, actionId);
    const row = elig!.rows.find((r) => r.enrollmentId === enrollmentId)!;
    expect(row.eligible).toBe(false);
    expect(row.reasons).toContain("survey_pending");

    const issued = await issueCertificate(admin, enrollmentId);
    expect(issued.ok).toBe(false);
    if (!issued.ok) expect(issued.error).toBe("not_eligible");
  });

  it("bloquea por asistencia SENCE bajo el umbral (sin sesiones)", async () => {
    const { actionId, enrollmentId } = await makeAction({
      rules: { requireAllLessons: false, requireSurvey: false, minAttendancePct: 0 },
      sence: true, override: 50, dates: ["2026-07-01", "2026-07-10"],
    });
    const elig = await getActionEligibility(admin, actionId);
    const row = elig!.rows.find((r) => r.enrollmentId === enrollmentId)!;
    expect(row.eligible).toBe(false);
    expect(row.reasons).toContain("attendance_below_min");
  });

  it("issueBatch emite a los elegibles y omite al resto", async () => {
    const { actionId } = await makeAction({ rules: { requireAllLessons: false, requireSurvey: false, minAttendancePct: 0 }, sence: false });
    const res = await issueBatch(admin, actionId);
    expect(res.issued).toBeGreaterThanOrEqual(1);

    // El alumno ve su certificado.
    const { getMyCertificates } = await import("@/modules/certificados/certificates-service");
    const mine = await getMyCertificates(student);
    expect(mine.length).toBeGreaterThanOrEqual(1);
  });
});
