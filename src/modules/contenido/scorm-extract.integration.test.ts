/**
 * Integración de la extracción/validación SCORM (task 5.1a, HU-4.2, ADR-006):
 * `runScormExtract`/`runScormSweep` (lógica del worker) contra Storage y
 * Postgres reales. Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runScormExtract, runScormSweep } from "@/modules/contenido/scorm-extract";
import { buildScormFixtureZip, buildScormZipBombFixture } from "@/modules/contenido/testing/scorm-fixture";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const COURSE_A = "c0000000-0000-4000-8000-000000000001";
const UPLOADED_BY = "aaaaaaaa-0000-4000-8000-000000000001";
const BUCKET = "scorm";

let svc: SupabaseClient;
const seededPackages: string[] = [];

function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

beforeAll(() => {
  const e = env();
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
});

afterAll(async () => {
  for (const id of seededPackages) {
    await svc.storage.from(BUCKET).remove([`${TENANT_A}/${id}/package.zip`]);
    await svc.from("scorm_packages").delete().eq("id", id);
  }
});

async function seedPackage(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  const { error } = await svc.from("scorm_packages").insert({
    id,
    tenant_id: TENANT_A,
    course_id: COURSE_A,
    title: "Paquete de integración (RLS/worker)",
    status: "uploaded",
    zip_path: `${TENANT_A}/${id}/package.zip`,
    uploaded_by: UPLOADED_BY,
    file_size: 1000,
    ...overrides,
  });
  if (error) throw new Error(`seed scorm_packages: ${error.message}`);
  seededPackages.push(id);
  return id;
}

async function uploadZip(id: string, buffer: Buffer): Promise<void> {
  const up = await svc.storage
    .from(BUCKET)
    .upload(`${TENANT_A}/${id}/package.zip`, buffer, { contentType: "application/zip", upsert: true });
  if (up.error) throw new Error(`upload fixture: ${up.error.message}`);
}

describe("runScormExtract (task 5.1a)", () => {
  it("extrae un paquete válido: ready + entry_href + versión + asset descargable", async () => {
    const id = await seedPackage();
    await uploadZip(id, await buildScormFixtureZip());

    const result = await runScormExtract(svc, { packageId: id, tenantId: TENANT_A, now: Date.now() });
    expect(result).toEqual({ ok: true });

    const { data: row } = await svc
      .from("scorm_packages")
      .select("status, scorm_version, entry_href, extracted_prefix, manifest, error_code")
      .eq("id", id)
      .maybeSingle();
    expect(row?.status).toBe("ready");
    expect(row?.scorm_version).toBe("1.2");
    expect(row?.entry_href).toBe("index.html");
    expect(row?.extracted_prefix).toBe(`${TENANT_A}/${id}/ext`);
    expect(row?.error_code).toBeNull();
    expect(row?.manifest).toMatchObject({ version: "1.2", entryHref: "index.html", resourceCount: 1 });

    const dl = await svc.storage.from(BUCKET).download(`${TENANT_A}/${id}/ext/index.html`);
    expect(dl.error).toBeNull();
    const text = await dl.data!.text();
    expect(text).toContain("LMSInitialize");
  });

  it("zip corrupto (bytes al azar con extensión .zip) → status=error con un código del enum", async () => {
    const id = await seedPackage();
    await uploadZip(id, randomBytes(300));

    const result = await runScormExtract(svc, { packageId: id, tenantId: TENANT_A, now: Date.now() });
    expect(result.ok).toBe(false);

    const { data: row } = await svc.from("scorm_packages").select("status, error_code").eq("id", id).maybeSingle();
    expect(row?.status).toBe("error");
    expect(row?.error_code).not.toBeNull();
  });

  it("zip SIN imsmanifest.xml → no_manifest", async () => {
    const id = await seedPackage();
    await uploadZip(id, await buildScormFixtureZip({ includeManifest: false }));

    const result = await runScormExtract(svc, { packageId: id, tenantId: TENANT_A, now: Date.now() });
    expect(result).toEqual({ ok: false, errorCode: "no_manifest" });

    const { data: row } = await svc.from("scorm_packages").select("status, error_code").eq("id", id).maybeSingle();
    expect(row).toEqual({ status: "error", error_code: "no_manifest" });
  });

  it("zip con una entrada '../evil.js' → unsafe_path, NADA llega a subir a Storage", async () => {
    const id = await seedPackage();
    await uploadZip(id, await buildScormFixtureZip({ extraEntries: { "../evil.js": "contenido malicioso ficticio" } }));

    const result = await runScormExtract(svc, { packageId: id, tenantId: TENANT_A, now: Date.now() });
    expect(result).toEqual({ ok: false, errorCode: "unsafe_path" });

    const { data: row } = await svc
      .from("scorm_packages")
      .select("status, error_code, extracted_prefix")
      .eq("id", id)
      .maybeSingle();
    expect(row?.status).toBe("error");
    expect(row?.error_code).toBe("unsafe_path");
    expect(row?.extracted_prefix).toBeNull();

    const list = await svc.storage.from(BUCKET).list(`${TENANT_A}/${id}/ext`);
    expect(list.data ?? []).toHaveLength(0);
  });

  it("zip que MIENTE el tamaño descomprimido declarado de una entry → el streaming REAL corta igual (hallazgo 4-ojos HIGH, bypass del pre-chequeo)", async () => {
    // Reproduce el ataque bit a bit (no solo la aritmética pura de
    // `exceedsUncompressedBudget`): un .zip 100% válido cuya entry "bomb.bin"
    // pesa 2.000.000 de bytes REALES al descomprimir, pero cuyo directorio
    // central MIENTE que pesa apenas 10 bytes (`forgeDeclaredUncompressedSize`).
    // El pre-chequeo por tamaño DECLARADO (`declaredUncompressedSize` +
    // `exceedsUncompressedBudget`, contra el presupuesto real de producción de
    // 500 MB) pasa igual de largo — declarado o real, 2 MB está muy por debajo
    // de 500 MB — así que lo que debe atajar esto es el streaming de bytes
    // REALES. `uncompressedBudgetOverrideBytes` (hook SOLO de tests) acota ese
    // segundo guardia a 100 KB para no tener que inflar cientos de MB en CI:
    // si `runScormExtract` alguna vez volviera a confiar en el campo mentiroso
    // del header (10 bytes, muy por debajo de cualquier presupuesto) en vez de
    // los bytes reales emitidos por jszip, este test fallaría.
    const id = await seedPackage();
    const REAL_BYTES = 2_000_000;
    await uploadZip(id, await buildScormZipBombFixture(REAL_BYTES));

    const result = await runScormExtract(svc, {
      packageId: id,
      tenantId: TENANT_A,
      now: Date.now(),
      uncompressedBudgetOverrideBytes: 100_000,
    });
    expect(result).toEqual({ ok: false, errorCode: "too_large" });

    const { data: row } = await svc
      .from("scorm_packages")
      .select("status, error_code, extracted_prefix")
      .eq("id", id)
      .maybeSingle();
    expect(row?.status).toBe("error");
    expect(row?.error_code).toBe("too_large");
    expect(row?.extracted_prefix).toBeNull();

    // Nada llega a quedar subido en Storage: el corte ocurre durante el
    // streaming, antes de completar la subida de ningún asset extraído.
    const list = await svc.storage.from(BUCKET).list(`${TENANT_A}/${id}/ext`);
    expect(list.data ?? []).toHaveLength(0);
  });
});

describe("runScormSweep (task 5.1a)", () => {
  it("reprocesa una fila `uploaded` vieja (posible fallo de encolado)", async () => {
    // `updated_at` se fija AL INSERTAR (el trigger `touch_updated_at` solo
    // corre en UPDATE): así queda "vieja" desde el nacimiento de la fila, sin
    // pelear con el trigger.
    const oldIso = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const id = await seedPackage({ updated_at: oldIso });
    await uploadZip(id, await buildScormFixtureZip());

    const summary = await runScormSweep(svc, { now: Date.now() });
    expect(summary.reprocessed).toBeGreaterThanOrEqual(1);

    const { data: row } = await svc.from("scorm_packages").select("status").eq("id", id).maybeSingle();
    expect(row?.status).toBe("ready");
  });

  it("no toca una fila `uploaded` reciente", async () => {
    const id = await seedPackage();
    await uploadZip(id, await buildScormFixtureZip());

    await runScormSweep(svc, { now: Date.now() });

    const { data: row } = await svc.from("scorm_packages").select("status").eq("id", id).maybeSingle();
    expect(row?.status).toBe("uploaded");
  });
});
