/**
 * Integración del Portal Supervisor (task 3.11) contra Supabase local: alta de
 * grant (usuario+membresía+grant+auditoría), portal GATED (scope + auditoría por
 * consulta), revocación que corta el acceso. Requiere `db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "@/modules/core/domain/rbac";
import { noopEmailSender } from "@/modules/comunicacion/email-sender";
import { createGrant, listGrants, revokeGrant } from "@/modules/portal-empresa/supervisor-grant-service";
import { getSupervisorExport, getSupervisorPanel, listSupervisorActions } from "@/modules/portal-empresa/supervisor-portal-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const admin: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };

let svc: SupabaseClient;
function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

async function freshActionWithEnrollment(): Promise<string> {
  const courseId = randomUUID();
  await svc.from("courses").insert({ id: courseId, tenant_id: TENANT_A, name: "Curso sup", sence: true, cod_sence: "1234567890" });
  const actionId = randomUUID();
  await svc.from("actions").insert({ id: actionId, tenant_id: TENANT_A, course_id: courseId, codigo_accion: `SUP-${randomUUID().slice(0, 6)}`, training_line: 3, environment: "rcetest" });
  await svc.from("enrollments").insert({ tenant_id: TENANT_A, action_id: actionId, user_id: "aaaaaaaa-0000-4000-8000-000000000005", run: "5126663-3", first_names: "Ana", last_names: "Díaz" });
  return actionId;
}

beforeAll(() => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
});

describe("portal supervisor — grant, alcance, auditoría, revocación", () => {
  it("crea grant con alcance, portal gated audita, fuera de alcance y revocado → sin acceso", async () => {
    const actionX = await freshActionWithEnrollment();
    const actionY = await freshActionWithEnrollment();
    const email = `sup-${randomUUID().slice(0, 8)}@otec.cl`;

    // Alta con alcance = solo actionX.
    const created = await createGrant(admin, { email, scope: "actions", actionIds: [actionX] }, { emailSender: noopEmailSender() });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.inviteLink).toBeTruthy();

    // Auditoría del alta.
    expect((await svc.from("audit_log").select("id").eq("action", "supervisor.grant_created").eq("entity_id", created.grantId)).data?.length ?? 0).toBeGreaterThanOrEqual(1);

    // Alumno NO puede crear grants.
    const student: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000005", tenantId: TENANT_A, roles: ["student"] };
    expect((await createGrant(student, { email: "x@x.cl", scope: "tenant" })).ok).toBe(false);
    // Acción de otro tenant en el alcance → rechazada.
    expect((await createGrant(admin, { email: "y@y.cl", scope: "actions", actionIds: [randomUUID()] })).ok).toBe(false);

    // El usuario del grant (para armar su Principal).
    const grantRow = await svc.from("supervisor_grants").select("user_id").eq("id", created.grantId).single();
    const supervisor: Principal = { userId: grantRow.data!.user_id as string, tenantId: TENANT_A, roles: ["supervisor"] };

    // Portal GATED: ve actionX (en alcance), NO actionY.
    const panelX = await getSupervisorPanel(supervisor, actionX);
    expect(panelX).not.toBeNull();
    expect(await getSupervisorPanel(supervisor, actionY)).toBeNull();
    // Cada consulta audita.
    expect((await svc.from("audit_log").select("id").eq("action", "supervisor.panel_viewed").eq("entity_id", actionX)).data?.length ?? 0).toBeGreaterThanOrEqual(1);

    // Export en alcance audita como descarga.
    expect(await getSupervisorExport(supervisor, actionX)).not.toBeNull();
    expect((await svc.from("audit_log").select("id").eq("action", "supervisor.report_downloaded").eq("entity_id", actionX)).data?.length ?? 0).toBeGreaterThanOrEqual(1);

    // Índice: solo la acción en alcance.
    const visible = await listSupervisorActions(supervisor);
    expect(visible.some((a) => a.actionId === actionX)).toBe(true);
    expect(visible.some((a) => a.actionId === actionY)).toBe(false);

    // Revocación → corta el acceso.
    expect((await revokeGrant(admin, created.grantId)).ok).toBe(true);
    expect(await getSupervisorPanel(supervisor, actionX)).toBeNull();
    expect(await listSupervisorActions(supervisor)).toHaveLength(0);

    // listGrants refleja el estado revocado.
    const grants = await listGrants(admin);
    expect(grants?.find((g) => g.id === created.grantId)?.status).toBe("revoked");
  });
});
