/**
 * Integración del CRUD de acciones SENCE (task 1.2): crea/lista/edita vía
 * tenantGuard, respeta permisos, aislamiento y el comodín -1 solo en rcetest.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

import { createAction, listActions, updateAction } from "@/modules/academico/action-service";
import type { Principal } from "@/modules/core/domain/rbac";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const COURSE_A = "c0000000-0000-4000-8000-000000000001"; // curso demo (tenant A)

const adminA: Principal = { userId: "a", tenantId: TENANT_A, roles: ["otec_admin"] };
const studentA: Principal = { userId: "s", tenantId: TENANT_A, roles: ["student"] };
const adminB: Principal = { userId: "b", tenantId: TENANT_B, roles: ["otec_admin"] };

const base = {
  courseId: COURSE_A,
  codigoAccion: "ACC-2026-777",
  trainingLine: "3",
  environment: "rcetest",
  attendanceLock: "true",
  startsOn: "2026-08-01",
  endsOn: "2026-08-31",
};

beforeAll(() => {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string) => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  process.env.NEXT_PUBLIC_SUPABASE_URL = get("API_URL");
  process.env.SUPABASE_SERVICE_ROLE_KEY = get("SERVICE_ROLE_KEY");
});

describe("CRUD de acciones SENCE (task 1.2)", () => {
  it("un student no puede crear (deny-by-default)", async () => {
    expect(await createAction(studentA, base)).toEqual({ ok: false, error: "forbidden" });
  });

  it("rechaza el comodín -1 en producción (rce)", async () => {
    const r = await createAction(adminA, { ...base, codigoAccion: "-1", environment: "rce" });
    expect("validation" in r).toBe(true);
  });

  it("el admin crea una acción y aparece en el listado", async () => {
    const r = await createAction(adminA, base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const actions = await listActions(adminA);
    const created = actions.find((a) => a.id === r.id);
    expect(created?.codigo_accion).toBe("ACC-2026-777");
    expect(created?.environment).toBe("rcetest");
    expect(created?.training_line).toBe(3);
  });

  it("no se puede crear una acción sobre un curso de OTRO tenant (aislamiento)", async () => {
    const r = await createAction(adminB, base); // COURSE_A es del tenant A
    expect(r).toEqual({ ok: false, error: "course_not_found" });
  });

  it("editar una acción de otro tenant no la toca", async () => {
    const created = await createAction(adminA, { ...base, codigoAccion: "SOLO-A" });
    if (!created.ok) throw new Error("no se creó");
    const r = await updateAction(adminB, created.id, { ...base, codigoAccion: "HACK" });
    expect(r).toEqual({ ok: false, error: "not_found" });
    const actions = await listActions(adminA);
    expect(actions.find((a) => a.id === created.id)?.codigo_accion).toBe("SOLO-A");
  });

  it("el admin puede pasar la acción demo a rcetest con el comodín -1 (prep certificación)", async () => {
    // la acción demo sembrada
    const DEMO = "ac000000-0000-4000-8000-000000000001";
    const r = await updateAction(adminA, DEMO, {
      ...base,
      codigoAccion: "-1",
      environment: "rcetest",
    });
    expect(r.ok).toBe(true);
    const actions = await listActions(adminA);
    expect(actions.find((a) => a.id === DEMO)?.codigo_accion).toBe("-1");
  });
});
