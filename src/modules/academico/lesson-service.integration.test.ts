/**
 * Integración del constructor de lecciones (task 1.4): CRUD + reordenar vía
 * tenantGuard, permisos y aislamiento.
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

import { createLesson, deleteLesson, listLessons, moveLesson, updateLesson } from "@/modules/academico/lesson-service";
import type { Principal } from "@/modules/core/domain/rbac";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const COURSE_A = "c0000000-0000-4000-8000-000000000001";

const adminA: Principal = { userId: "a", tenantId: TENANT_A, roles: ["otec_admin"] };
const studentA: Principal = { userId: "s", tenantId: TENANT_A, roles: ["student"] };
const adminB: Principal = { userId: "b", tenantId: TENANT_B, roles: ["otec_admin"] };

beforeAll(() => {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string) => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  process.env.NEXT_PUBLIC_SUPABASE_URL = get("API_URL");
  process.env.SUPABASE_SERVICE_ROLE_KEY = get("SERVICE_ROLE_KEY");
});

describe("constructor de lecciones (task 1.4, HU-4.1)", () => {
  it("un student no puede crear (deny-by-default)", async () => {
    const r = await createLesson(studentA, COURSE_A, { title: "X", kind: "text", content: "y", status: "draft" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
  });

  it("rechaza contenido inválido según el tipo", async () => {
    const r = await createLesson(adminA, COURSE_A, { title: "Vid", kind: "file", content: "no-url", status: "draft" });
    expect("validation" in r).toBe(true);
  });

  it("no permite crear lección en un curso de OTRO tenant", async () => {
    const r = await createLesson(adminB, COURSE_A, { title: "X", kind: "text", content: "y", status: "draft" });
    expect(r).toEqual({ ok: false, error: "course_not_found" });
  });

  it("crea, edita, publica y aparece en el listado ordenado", async () => {
    // Posición relativa al estado actual (el curso demo acumula lecciones si la
    // suite se repite sin `db reset`): la nueva SIEMPRE entra al final.
    const before = await listLessons(adminA, COURSE_A);

    const r = await createLesson(adminA, COURSE_A, { title: "Nueva 3", kind: "embed", content: "https://x.cl/e", status: "draft" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const upd = await updateLesson(adminA, r.id, { title: "Nueva 3 editada", kind: "embed", content: "https://x.cl/e2", status: "published" });
    expect(upd.ok).toBe(true);

    const lessons = await listLessons(adminA, COURSE_A);
    const positions = lessons.map((l) => l.position);
    expect([...positions]).toEqual([...positions].sort((a, b) => a - b)); // ordenado
    const created = lessons.find((l) => l.id === r.id);
    expect(created?.title).toBe("Nueva 3 editada");
    expect(created?.status).toBe("published");
    expect(created?.position).toBe(before.length + 1); // al final
  });

  it("reordena: mover la última hacia arriba intercambia posiciones", async () => {
    const before = await listLessons(adminA, COURSE_A);
    const last = before[before.length - 1]!;
    const prev = before[before.length - 2]!;
    await moveLesson(adminA, last.id, "up");
    const after = await listLessons(adminA, COURSE_A);
    expect(after.find((l) => l.id === last.id)?.position).toBe(prev.position);
    expect(after.find((l) => l.id === prev.id)?.position).toBe(last.position);
  });

  it("borra una lección", async () => {
    const created = await createLesson(adminA, COURSE_A, { title: "Temporal", kind: "text", content: "z", status: "draft" });
    if (!created.ok) throw new Error("no creada");
    expect((await deleteLesson(adminA, created.id)).ok).toBe(true);
    const lessons = await listLessons(adminA, COURSE_A);
    expect(lessons.find((l) => l.id === created.id)).toBeUndefined();
  });
});
