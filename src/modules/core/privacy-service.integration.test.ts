/**
 * Integración de derechos Ley 21.719 (task 3.5) contra Supabase local:
 * consentimiento idempotente, export del titular, solicitudes, y supresión que
 * CONSERVA los registros SENCE/certificados/auditoría. Requiere `db reset`.
 */
import { execSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "@/modules/core/domain/rbac";
import { applyErasure, exportMyData, hasCurrentConsent, listDsrRequests, recordConsent, requestDsr } from "@/modules/core/privacy-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const USER_STUDENT = "aaaaaaaa-0000-4000-8000-000000000005";
const SEED_SESSION = "50000000-0000-4000-8000-000000000001"; // sesión SENCE del seed (STUDENT)
const student: Principal = { userId: USER_STUDENT, tenantId: TENANT_A, roles: ["student"] };
const admin: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };
const other: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000006", tenantId: TENANT_A, roles: ["student"] };

let svc: SupabaseClient;
function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

beforeAll(() => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
});

describe("consentimiento", () => {
  it("recordConsent es idempotente y hasCurrentConsent lo refleja", async () => {
    expect(await hasCurrentConsent(other)).toBe(false);
    expect((await recordConsent(other, "1.2.3.4")).ok).toBe(true);
    expect(await hasCurrentConsent(other)).toBe(true);
    expect((await recordConsent(other, "1.2.3.4")).ok).toBe(true); // idempotente
  });
});

describe("export del titular", () => {
  it("incluye los datos del usuario y excluye a otros", async () => {
    const bundle = await exportMyData(student);
    expect(bundle).not.toBeNull();
    expect(bundle!.userId).toBe(USER_STUDENT);
    // El alumno demo tiene inscripción + sesión SENCE + nota en el seed.
    expect(Array.isArray(bundle!.data.enrollments)).toBe(true);
    expect((bundle!.data.enrollments as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(bundle!.data.senceSessions)).toBe(true);
  });
});

describe("solicitudes + supresión que conserva SENCE", () => {
  it("crea solicitud, el staff la lista, y la supresión conserva la sesión SENCE + audita", async () => {
    const req = await requestDsr(student, { kind: "erasure", detail: "Deseo suprimir mis datos" });
    expect(req.ok).toBe(true);
    if (!req.ok) return;

    const list = await listDsrRequests(admin);
    expect(list.some((r) => r.id === req.id)).toBe(true);
    expect((await listDsrRequests(student)).length).toBe(0); // el alumno no es staff

    const res = await applyErasure(admin, req.id);
    expect(res.ok).toBe(true);
    expect(res.retainedCount).toBeGreaterThanOrEqual(1);

    // La sesión SENCE del seed SIGUE existiendo (retención legal).
    const { data: session } = await svc.from("sence_sessions").select("id").eq("id", SEED_SESSION).maybeSingle();
    expect(session).not.toBeNull();

    // La solicitud quedó completada con nota de retención.
    const { data: done } = await svc.from("dsr_requests").select("status, resolution_note").eq("id", req.id).maybeSingle();
    expect(done!.status).toBe("completed");
    expect(String(done!.resolution_note)).toContain("Conservado");

    // Se auditó la supresión.
    const { data: audit } = await svc.from("audit_log").select("id").eq("tenant_id", TENANT_A).eq("action", "dsr.erasure_applied").eq("entity_id", req.id);
    expect((audit ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
