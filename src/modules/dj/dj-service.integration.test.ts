/**
 * Integración del servicio de DJ (task 3.3) contra Supabase local: siembra
 * idempotente (excluye exentos), transiciones válidas/ilegales con auditoría,
 * authz (solo staff gestiona) y nómina. Requiere `db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "@/modules/core/domain/rbac";
import { ensureChecklist, exportRoster, getChecklist, setDjState } from "@/modules/dj/dj-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const admin: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };
const student: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000005", tenantId: TENANT_A, roles: ["student"] };

let svc: SupabaseClient;
function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

/** Acción fresca con 2 inscritos no exentos + 1 exento. */
async function freshAction(): Promise<{ actionId: string }> {
  const courseId = randomUUID();
  await svc.from("courses").insert({ id: courseId, tenant_id: TENANT_A, name: "Curso DJ", sence: true, cod_sence: "1234567890" });
  const actionId = randomUUID();
  await svc.from("actions").insert({ id: actionId, tenant_id: TENANT_A, course_id: courseId, codigo_accion: `DJ-${randomUUID().slice(0, 6)}`, training_line: 3, environment: "rcetest", ends_on: "2026-07-01" });
  const rows = [
    { tenant_id: TENANT_A, action_id: actionId, user_id: "aaaaaaaa-0000-4000-8000-000000000005", run: "5126663-3", exento: false, first_names: "Ana", last_names: "Díaz" },
    { tenant_id: TENANT_A, action_id: actionId, user_id: "aaaaaaaa-0000-4000-8000-000000000006", run: "6222444-9", exento: false, first_names: "Beto", last_names: "Soto" },
    { tenant_id: TENANT_A, action_id: actionId, user_id: "aaaaaaaa-0000-4000-8000-000000000007", run: "7333555-1", exento: true, first_names: "Cata", last_names: "Vera" },
  ];
  const ins = await svc.from("enrollments").insert(rows);
  if (ins.error) throw new Error(`seed enrollments: ${ins.error.message}`);
  return { actionId };
}

beforeAll(() => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
});

describe("dj-service — siembra, transiciones, authz, nómina", () => {
  it("siembra idempotente (excluye exentos), calcula liquidación 60d y arma nómina", async () => {
    const { actionId } = await freshAction();

    // Alumno no puede sembrar.
    expect((await ensureChecklist(student, actionId)).ok).toBe(false);

    const first = await ensureChecklist(admin, actionId);
    expect(first).toEqual({ ok: true, created: 2 }); // el exento queda fuera
    // Re-ejecutar no duplica (unique + ignoreDuplicates).
    await ensureChecklist(admin, actionId);
    const rows = await getChecklist(admin, actionId);
    expect(rows).not.toBeNull();
    expect(rows!.length).toBe(2);
    expect(rows!.every((r) => r.state === "pendiente_emitir")).toBe(true);
    expect(rows!.every((r) => r.settlementDeadline === "2026-08-30")).toBe(true);

    const target = rows![0]!;

    // Alumno no puede cambiar estado.
    expect(await setDjState(student, target.id, "emitida")).toEqual({ ok: false, error: "forbidden" });

    // Transición legal → ok + auditoría.
    expect(await setDjState(admin, target.id, "emitida", "GCA cargada")).toEqual({ ok: true });
    const audit = await svc.from("audit_log").select("action").eq("entity_id", target.id).eq("action", "dj.state_changed");
    expect((audit.data ?? []).length).toBeGreaterThanOrEqual(1);

    // Transición ilegal (emitida → pendiente_emitir) → rechazada.
    expect(await setDjState(admin, target.id, "pendiente_emitir")).toEqual({ ok: false, error: "invalid_transition" });

    // Nómina: 2 filas + 7 columnas.
    const roster = await exportRoster(admin, actionId);
    expect(roster).not.toBeNull();
    expect(roster!.headers.length).toBe(7);
    expect(roster!.rows.length).toBe(2);
  });
});
