/**
 * Integración de la ingesta SCORM (task 5.1a, HU-4.2, ADR-006):
 * `uploadScormPackage` end-to-end (gate de feature flag, MIME/magic bytes,
 * rollback compensatorio si Storage falla) y el enganche con
 * `createLesson`/`updateLesson` (`package_not_ready`/`package_not_found`).
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLesson, updateLesson } from "@/modules/academico/lesson-service";
import type { Principal } from "@/modules/core/domain/rbac";
import { deleteScormPackage, uploadScormPackage } from "@/modules/contenido/scorm-service";
import { buildScormFixtureZip } from "@/modules/contenido/testing/scorm-fixture";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const COURSE_A = "c0000000-0000-4000-8000-000000000001";
const BUCKET = "scorm";

const admin: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };
const student: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000005", tenantId: TENANT_A, roles: ["student"] };

let svc: SupabaseClient;
let anon: SupabaseClient;
const seededPackages: string[] = [];
const seededLessons: string[] = [];
const seededCourses: string[] = [];

function env(): { apiUrl: string; serviceRoleKey: string; anonKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY"), anonKey: get("ANON_KEY") };
}

async function zipFile(): Promise<{ name: string; type: string; size: number; bytes: ArrayBuffer }> {
  const buf = await buildScormFixtureZip();
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return { name: "curso.zip", type: "application/zip", size: buf.byteLength, bytes };
}

beforeAll(() => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
  // Cliente `anon`: NO tiene GRANT de UPDATE sobre `scorm_packages` (la
  // migración solo lo concede a `service_role`) — sirve para reproducir un
  // fallo REAL de esa escritura puntual sin SQL crudo (ver el hallazgo de
  // 4-ojos sobre el `update({ zip_path })` sin chequear su error).
  anon = createClient(e.apiUrl, e.anonKey, { auth: { persistSession: false } });
});

afterAll(async () => {
  await svc.from("tenants").update({ flags: {} }).eq("id", TENANT_A);
  for (const id of seededLessons) await svc.from("lessons").delete().eq("id", id);
  for (const id of seededPackages) {
    await svc.storage.from(BUCKET).remove([`${TENANT_A}/${id}/package.zip`]);
    await svc.from("scorm_packages").delete().eq("id", id);
  }
  for (const id of seededCourses) await svc.from("courses").delete().eq("id", id);
});

describe("uploadScormPackage (task 5.1a)", () => {
  it("feature_disabled cuando el tenant NO tiene el flag 'scorm' encendido (default)", async () => {
    await svc.from("tenants").update({ flags: {} }).eq("id", TENANT_A);
    const result = await uploadScormPackage(admin, COURSE_A, { title: "Sin flag", file: await zipFile() });
    expect(result).toEqual({ ok: false, error: "feature_disabled" });
  });

  it("forbidden para un alumno (deny-by-default) aunque el flag esté prendido", async () => {
    await svc.from("tenants").update({ flags: { scorm: true } }).eq("id", TENANT_A);
    const result = await uploadScormPackage(student, COURSE_A, { title: "Intento alumno", file: await zipFile() });
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("rechaza MIME inválido (magic bytes no coinciden con un .zip)", async () => {
    const result = await uploadScormPackage(admin, COURSE_A, {
      title: "Falso zip",
      file: {
        name: "x.zip",
        type: "text/plain",
        size: 20,
        bytes: new TextEncoder().encode("esto no es un zip real").buffer as ArrayBuffer,
      },
    });
    expect(result).toEqual({ ok: false, error: "invalid" });
  });

  it("sube de principio a fin: fila `uploaded` + objeto en Storage + auditoría", async () => {
    const result = await uploadScormPackage(admin, COURSE_A, { title: "Curso feliz", file: await zipFile() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    seededPackages.push(result.packageId);

    const { data: row } = await svc
      .from("scorm_packages")
      .select("status, zip_path, title")
      .eq("id", result.packageId)
      .maybeSingle();
    expect(row?.status).toBe("uploaded");
    expect(row?.title).toBe("Curso feliz");
    expect(row?.zip_path).toBe(`${TENANT_A}/${result.packageId}/package.zip`);

    const dl = await svc.storage.from(BUCKET).download(row!.zip_path as string);
    expect(dl.error).toBeNull();

    const { data: audit } = await svc
      .from("audit_log")
      .select("action")
      .eq("tenant_id", TENANT_A)
      .eq("entity_id", result.packageId)
      .eq("action", "scorm.package_uploaded");
    expect(audit?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("rollback: si Storage falla, no queda una fila huérfana", async () => {
    const before = await svc
      .from("scorm_packages")
      .select("id", { count: "exact", head: true })
      .eq("course_id", COURSE_A);

    await svc.storage.updateBucket(BUCKET, { public: false, fileSizeLimit: 10 });
    let result: Awaited<ReturnType<typeof uploadScormPackage>>;
    try {
      result = await uploadScormPackage(admin, COURSE_A, { title: "Debe fallar", file: await zipFile() });
    } finally {
      await svc.storage.updateBucket(BUCKET, { public: false, fileSizeLimit: 262144000 });
    }
    expect(result).toEqual({ ok: false, error: "storage_error" });

    const after = await svc
      .from("scorm_packages")
      .select("id", { count: "exact", head: true })
      .eq("course_id", COURSE_A);
    expect(after.count).toBe(before.count);
  });

  it("compensa si el UPDATE que enlaza zip_path falla: sin fila huérfana parada en error para siempre (hallazgo 4-ojos MED)", async () => {
    const before = await svc
      .from("scorm_packages")
      .select("id", { count: "exact", head: true })
      .eq("course_id", COURSE_A);

    // `linkDbOverride: anon` fuerza un fallo REAL (permission denied, código
    // 42501) en el UPDATE que enlaza `zip_path` — `anon` no tiene GRANT de
    // UPDATE sobre `scorm_packages` (solo `service_role` lo tiene) — sin
    // necesitar SQL crudo ni mocks. Antes del fix, esta escritura fallaba en
    // silencio: la fila quedaba con `zip_path: ""` (el placeholder del
    // insert) para siempre, y el .zip ya subido quedaba huérfano en Storage.
    const result = await uploadScormPackage(
      admin,
      COURSE_A,
      { title: "Debe compensar", file: await zipFile() },
      { linkDbOverride: anon },
    );
    expect(result).toEqual({ ok: false, error: "storage_error" });

    // Ninguna fila nueva quedó atrás (ni con zip_path="" apuntando a nada):
    // el fix compensa borrando la fila (mismo conteo que antes de intentar).
    const after = await svc
      .from("scorm_packages")
      .select("id", { count: "exact", head: true })
      .eq("course_id", COURSE_A);
    expect(after.count).toBe(before.count);
  });
});

describe("createLesson/updateLesson con paquete SCORM (task 5.1a)", () => {
  it("package_not_ready: no se puede publicar mientras el paquete no esté `ready`", async () => {
    const packageId = randomUUID();
    await svc.from("scorm_packages").insert({
      id: packageId,
      tenant_id: TENANT_A,
      course_id: COURSE_A,
      title: "Aún procesando",
      status: "uploaded",
      zip_path: `${TENANT_A}/${packageId}/package.zip`,
      uploaded_by: admin.userId,
      file_size: 100,
    });
    seededPackages.push(packageId);

    const created = await createLesson(admin, COURSE_A, {
      title: "Lección SCORM",
      kind: "scorm",
      content: packageId,
      status: "draft",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    seededLessons.push(created.id);

    const publish = await updateLesson(admin, created.id, {
      title: "Lección SCORM",
      kind: "scorm",
      content: packageId,
      status: "published",
    });
    expect(publish).toEqual({ ok: false, error: "package_not_ready" });

    // Cuando el paquete queda `ready`, SÍ se puede publicar.
    await svc.from("scorm_packages").update({ status: "ready" }).eq("id", packageId);
    const publishAgain = await updateLesson(admin, created.id, {
      title: "Lección SCORM",
      kind: "scorm",
      content: packageId,
      status: "published",
    });
    expect(publishAgain.ok).toBe(true);
  });

  it("package_not_found: el paquete debe pertenecer al MISMO curso de la lección", async () => {
    const otherCourseId = randomUUID();
    await svc.from("courses").insert({ id: otherCourseId, tenant_id: TENANT_A, name: "Otro curso (fixture)", sence: false });
    seededCourses.push(otherCourseId);

    const packageId = randomUUID();
    await svc.from("scorm_packages").insert({
      id: packageId,
      tenant_id: TENANT_A,
      course_id: otherCourseId,
      title: "De otro curso",
      status: "ready",
      zip_path: `${TENANT_A}/${packageId}/package.zip`,
      uploaded_by: admin.userId,
      file_size: 100,
    });

    const created = await createLesson(admin, COURSE_A, {
      title: "Cruzada entre cursos",
      kind: "scorm",
      content: packageId,
      status: "draft",
    });
    expect(created).toEqual({ ok: false, error: "package_not_found" });

    // Limpieza local: el FK `scorm_packages.course_id → courses` es RESTRICT.
    await svc.from("scorm_packages").delete().eq("id", packageId);
  });
});

describe("deleteScormPackage (task 5.1a)", () => {
  it("in_use: rechaza borrar un paquete referenciado por una lección kind=scorm", async () => {
    const packageId = randomUUID();
    await svc.from("scorm_packages").insert({
      id: packageId,
      tenant_id: TENANT_A,
      course_id: COURSE_A,
      title: "En uso",
      status: "ready",
      zip_path: `${TENANT_A}/${packageId}/package.zip`,
      uploaded_by: admin.userId,
      file_size: 100,
    });
    seededPackages.push(packageId);

    const created = await createLesson(admin, COURSE_A, {
      title: "Usa el paquete",
      kind: "scorm",
      content: packageId,
      status: "draft",
    });
    expect(created.ok).toBe(true);
    if (created.ok) seededLessons.push(created.id);

    const result = await deleteScormPackage(admin, packageId);
    expect(result).toEqual({ ok: false, error: "in_use" });
  });
});
