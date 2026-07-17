/**
 * Integración del procesamiento del descriptor SENCE en el worker (fix de
 * seguridad post-5.10, HU-3.5/4.5): `runDescriptorExtract`/`runDescriptorSweep`
 * (lógica del worker) contra Storage y Postgres reales. Requiere
 * `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runDescriptorExtract, runDescriptorSweep } from "@/modules/academico/descriptor-extract";
import {
  buildDescriptorFixtureDocx,
  buildDescriptorForgedSizeFixture,
  buildDescriptorZipBombFixture,
  DESCRIPTOR_FIXTURE_LINES,
} from "@/modules/academico/testing/descriptor-fixture";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const ADMIN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const BUCKET = "course_descriptors";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

let svc: SupabaseClient;
const seededDrafts: string[] = [];

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
  for (const id of seededDrafts) {
    await svc.storage.from(BUCKET).remove([`${TENANT_A}/${id}/descriptor.docx`]);
    await svc.from("course_drafts").delete().eq("id", id);
  }
});

async function seedDraft(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  const { error } = await svc.from("course_drafts").insert({
    id,
    tenant_id: TENANT_A,
    created_by: ADMIN_A,
    source: "descriptor",
    descriptor_path: `${TENANT_A}/${id}/descriptor.docx`,
    descriptor_name: "descriptor de prueba.docx",
    state: {},
    current_step: "datos",
    status: "processing",
    ...overrides,
  });
  if (error) throw new Error(`seed course_drafts: ${error.message}`);
  seededDrafts.push(id);
  return id;
}

async function uploadDescriptor(id: string, buffer: Buffer): Promise<void> {
  const up = await svc.storage.from(BUCKET).upload(`${TENANT_A}/${id}/descriptor.docx`, buffer, {
    contentType: DOCX_MIME,
    upsert: true,
  });
  if (up.error) throw new Error(`upload fixture: ${up.error.message}`);
}

describe("runDescriptorExtract (fix de seguridad post-5.10)", () => {
  it("procesa un .docx sintético válido: status vuelve a 'in_progress' con el state sembrado", async () => {
    const id = await seedDraft();
    await uploadDescriptor(id, await buildDescriptorFixtureDocx(DESCRIPTOR_FIXTURE_LINES));

    const result = await runDescriptorExtract(svc, { draftId: id, tenantId: TENANT_A });
    expect(result).toEqual({ ok: true });

    const { data: row } = await svc
      .from("course_drafts")
      .select("status, descriptor_error, state")
      .eq("id", id)
      .maybeSingle();
    expect(row?.status).toBe("in_progress");
    expect(row?.descriptor_error).toBeNull();
    expect(row?.state.datosSeed.name).toBe("Manejo seguro de extintores");
    expect(row?.state.datosSeed.hours).toBe(8);
    expect(row?.state.estructura.modules.map((m: { title: string }) => m.title)).toEqual([
      "Introducción a los extintores",
      "Uso práctico en emergencia",
    ]);
    expect(row?.state.outcomesSeed).toEqual([
      "Reconocer los tipos de extintores y su uso según la clase de fuego.",
      "Aplicar el protocolo de uso en una emergencia simulada.",
    ]);
    expect(row?.state.extractWarnings).toEqual([]);
  });

  it("un .docx que MIENTE su tamaño descomprimido declarado (chico) pero streamea bytes REALES que exceden el presupuesto → falla por el streaming REAL, no por el chequeo declarado (bypass real del guardia anti zip-bomb)", async () => {
    // Reproduce el ataque bit a bit (no solo la aritmética pura de
    // `exceedsDescriptorUncompressedBudget`): un .docx 100% válido cuya entry
    // "bomb.bin" pesa 2.000.000 de bytes REALES al descomprimir, pero cuyo
    // directorio central MIENTE que pesa apenas 10 bytes
    // (`forgeDeclaredUncompressedSize`, vía `buildDescriptorForgedSizeFixture`).
    // El pre-chequeo por tamaño DECLARADO pasa igual de largo (declarado o
    // real, 2 MB está muy por debajo del presupuesto de producción de 50 MB)
    // — lo que debe atajar esto es el streaming de bytes REALES.
    // `uncompressedBudgetOverrideBytes` (hook SOLO de tests) acota ese
    // segundo guardia a 100 KB para no inflar decenas de MB en cada corrida
    // de CI: si `runDescriptorExtract` alguna vez volviera a confiar SOLO en
    // el campo mentiroso del header (10 bytes) en vez de los bytes reales
    // emitidos por jszip, este test fallaría.
    const id = await seedDraft();
    const REAL_BYTES = 2_000_000;
    await uploadDescriptor(id, await buildDescriptorForgedSizeFixture(REAL_BYTES));

    const result = await runDescriptorExtract(svc, {
      draftId: id,
      tenantId: TENANT_A,
      uncompressedBudgetOverrideBytes: 100_000,
    });
    expect(result).toEqual({ ok: false, errorCode: "too_large" });

    const { data: row } = await svc.from("course_drafts").select("status, descriptor_error").eq("id", id).maybeSingle();
    expect(row?.status).toBe("failed");
    expect(row?.descriptor_error).toBe("too_large");
  });

  it("un .docx que declara HONESTAMENTE un tamaño descomprimido enorme → too_large por el pre-chequeo barato (sin llegar a streamear)", async () => {
    // "A".repeat(60 MB) con DEFLATE comprime a apenas unos KB (pasa de sobra
    // el límite de 10 MB del bucket), pero declara honestamente 60 MB
    // descomprimidos en el directorio central — por encima de
    // `MAX_DESCRIPTOR_UNCOMPRESSED_BYTES` (50 MB). Cubre el pre-chequeo
    // BARATO; el bypass real (declara chico, pesa grande) lo cubre el test
    // de arriba con `buildDescriptorForgedSizeFixture`.
    const id = await seedDraft();
    await uploadDescriptor(id, await buildDescriptorZipBombFixture(60 * 1024 * 1024));

    const result = await runDescriptorExtract(svc, { draftId: id, tenantId: TENANT_A });
    expect(result).toEqual({ ok: false, errorCode: "too_large" });

    const { data: row } = await svc.from("course_drafts").select("status, descriptor_error").eq("id", id).maybeSingle();
    expect(row?.status).toBe("failed");
    expect(row?.descriptor_error).toBe("too_large");
  });

  it("un .docx cuyo TEXTO extraído (bytes reales bajo presupuesto) es excesivamente largo → text_too_large", async () => {
    // ~2.1 millones de caracteres repetidos: comprime a casi nada (bytes
    // reales muy por debajo del presupuesto de 50 MB), pero el TEXTO que
    // `mammoth` extrae supera `MAX_DESCRIPTOR_TEXT_LENGTH` (2.000.000).
    const id = await seedDraft();
    const hugeLine = "A".repeat(2_100_000);
    await uploadDescriptor(id, await buildDescriptorFixtureDocx([hugeLine]));

    const result = await runDescriptorExtract(svc, { draftId: id, tenantId: TENANT_A });
    expect(result).toEqual({ ok: false, errorCode: "text_too_large" });

    const { data: row } = await svc.from("course_drafts").select("status, descriptor_error").eq("id", id).maybeSingle();
    expect(row?.status).toBe("failed");
    expect(row?.descriptor_error).toBe("text_too_large");
  });

  it("archivo corrupto (bytes al azar con extensión .docx) → invalid_zip", async () => {
    const id = await seedDraft();
    await uploadDescriptor(id, Buffer.from("no soy un zip ni un docx"));

    const result = await runDescriptorExtract(svc, { draftId: id, tenantId: TENANT_A });
    expect(result).toEqual({ ok: false, errorCode: "invalid_zip" });

    const { data: row } = await svc.from("course_drafts").select("status, descriptor_error").eq("id", id).maybeSingle();
    expect(row?.status).toBe("failed");
    expect(row?.descriptor_error).toBe("invalid_zip");
  });

  it("draft sin archivo en Storage (nunca se subió / se perdió) → storage_error", async () => {
    const id = await seedDraft(); // nunca se llama a uploadDescriptor

    const result = await runDescriptorExtract(svc, { draftId: id, tenantId: TENANT_A });
    expect(result).toEqual({ ok: false, errorCode: "storage_error" });

    const { data: row } = await svc.from("course_drafts").select("status, descriptor_error").eq("id", id).maybeSingle();
    expect(row?.status).toBe("failed");
    expect(row?.descriptor_error).toBe("storage_error");
  });

  it("draft inexistente → not_found, sin escribir nada", async () => {
    const result = await runDescriptorExtract(svc, { draftId: randomUUID(), tenantId: TENANT_A });
    expect(result).toEqual({ ok: false, errorCode: "not_found" });
  });

  it("un draft que YA avanzó a 'in_progress' (ediciones del usuario ya en curso) NO se vuelve a tocar (evita pisar el wizard con una reextracción vieja)", async () => {
    const id = await seedDraft({ status: "in_progress", state: { estructura: { modules: [{ id: "m1", title: "Editado a mano", hours: 4 }] } } });

    const result = await runDescriptorExtract(svc, { draftId: id, tenantId: TENANT_A });
    expect(result).toEqual({ ok: false, errorCode: "not_found" });

    const { data: row } = await svc.from("course_drafts").select("state").eq("id", id).maybeSingle();
    expect(row?.state.estructura.modules[0]?.title).toBe("Editado a mano");
  });

  it("draft sembrado bajo TENANT_A invocado con tenantId de TENANT_B → not_found, sin tocar el status/state (aislamiento cross-tenant)", async () => {
    const id = await seedDraft({ status: "processing", state: {} });
    await uploadDescriptor(id, await buildDescriptorFixtureDocx(DESCRIPTOR_FIXTURE_LINES));

    const result = await runDescriptorExtract(svc, { draftId: id, tenantId: TENANT_B });
    expect(result).toEqual({ ok: false, errorCode: "not_found" });

    const { data: row } = await svc
      .from("course_drafts")
      .select("status, descriptor_error, state")
      .eq("id", id)
      .maybeSingle();
    expect(row?.status).toBe("processing");
    expect(row?.descriptor_error).toBeNull();
    expect(row?.state).toEqual({});
  });
});

describe("runDescriptorSweep (fix de seguridad post-5.10)", () => {
  it("reprocesa un draft 'processing' viejo (posible fallo de encolado o worker muerto a medias)", async () => {
    const oldIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const id = await seedDraft({ updated_at: oldIso });
    await uploadDescriptor(id, await buildDescriptorFixtureDocx(DESCRIPTOR_FIXTURE_LINES));

    const summary = await runDescriptorSweep(svc, { now: Date.now() });
    expect(summary.reprocessed).toBeGreaterThanOrEqual(1);

    const { data: row } = await svc.from("course_drafts").select("status").eq("id", id).maybeSingle();
    expect(row?.status).toBe("in_progress");
  });

  it("no toca un draft 'processing' reciente", async () => {
    const id = await seedDraft();
    await uploadDescriptor(id, await buildDescriptorFixtureDocx(DESCRIPTOR_FIXTURE_LINES));

    await runDescriptorSweep(svc, { now: Date.now() });

    const { data: row } = await svc.from("course_drafts").select("status").eq("id", id).maybeSingle();
    expect(row?.status).toBe("processing");
  });
});
