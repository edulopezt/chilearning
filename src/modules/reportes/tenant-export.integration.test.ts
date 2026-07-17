/**
 * Integración del export completo del tenant (task 5.13, HU-1.5) contra
 * Supabase local: solicitar (gate + índice único), procesar con el worker
 * (`runTenantExportTick`) y verificar el ZIP resultante por CONTENIDO —no solo
 * el status— incluida la disciplina de tenant del runner (foco #1 de la
 * revisión de 4 ojos: el service-role bypassa RLS, así que el filtro por
 * tenant lo pone el propio runner, no la BD).
 *
 * Requiere `supabase start` + `supabase db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EmailSender, OutgoingEmail } from "@/modules/comunicacion/email-sender";
import type { Principal } from "@/modules/core/domain/rbac";
import { getExportDownloadUrl, listExports, requestExport } from "@/modules/reportes/tenant-export-service";
import { runTenantExportTick, type TenantExportRunnerDeps } from "@/modules/reportes/tenant-export-runner";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const admin: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };
const coordinator: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000002", tenantId: TENANT_A, roles: ["coordinator"] };
const USER_B = "bbbbbbbb-0000-4000-8000-000000000005";

const EXPORTS_BUCKET_CONFIG = { public: false, fileSizeLimit: 524288000, allowedMimeTypes: ["application/zip"] };

let svc: SupabaseClient;
const seeded = { courses: [] as string[], actions: [] as string[], enrollments: [] as string[] };

function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}

function captureSender(): { sender: EmailSender; sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return { sent, sender: { configured: true, async send(email) { sent.push(email); return { ok: true, id: "x" }; } } };
}

/** Fixture de TENANT_B: sin esto el tenant B tendría CERO filas en `enrollments`
 *  y "cero filas del tenant B" sería verdad por vacío, no por disciplina del runner. */
async function makeTenantBEnrollment(): Promise<string> {
  const courseId = randomUUID();
  await svc.from("courses").insert({ id: courseId, tenant_id: TENANT_B, name: "Curso export tenant B", sence: false });
  seeded.courses.push(courseId);
  const actionId = randomUUID();
  await svc.from("actions").insert({ id: actionId, tenant_id: TENANT_B, course_id: courseId, codigo_accion: `EXP-B-${randomUUID().slice(0, 6)}`, training_line: 3 });
  seeded.actions.push(actionId);
  const enrollmentId = randomUUID();
  await svc.from("enrollments").insert({ id: enrollmentId, tenant_id: TENANT_B, action_id: actionId, user_id: USER_B, run: "9876543-1" });
  seeded.enrollments.push(enrollmentId);
  return enrollmentId;
}

async function tick(overrides?: Partial<TenantExportRunnerDeps>): Promise<{ summary: Awaited<ReturnType<typeof runTenantExportTick>>; sent: OutgoingEmail[] }> {
  const { sender, sent } = captureSender();
  const summary = await runTenantExportTick(svc, {
    emailSender: sender,
    resolveRecipients: async () => new Map([[admin.userId, { email: "ana.silva@ejemplo.cl", name: "Ana Silva" }]]),
    appBaseUrl: "https://test.example",
    ...overrides,
  });
  return { summary, sent };
}

beforeAll(async () => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });

  // Fixture del hallazgo MED "sence_events sin atribuir nunca aparecen en
  // ningún export": un evento con tenant_id NULL (correlación fallida, I-1) es
  // INSERT-only por diseño (no se puede borrar ni con service_role — trigger
  // `sence_events_no_update`/no_truncate — así que este residuo queda para
  // siempre, mismo criterio que el resto de la bitácora SENCE).
  await svc.from("sence_events").insert({
    tenant_id: null,
    session_id: null,
    kind: "unmatched",
    dedupe_hash: `export-test-unattributed-${randomUUID()}`,
    received_at: new Date().toISOString(),
  });
});

afterAll(async () => {
  // `enrollments`/`actions`/`courses` sí tienen DELETE para service_role: limpiar
  // en orden (hijo → padre) respeta los `on delete restrict`.
  if (seeded.enrollments.length) await svc.from("enrollments").delete().in("id", seeded.enrollments);
  if (seeded.actions.length) await svc.from("actions").delete().in("id", seeded.actions);
  if (seeded.courses.length) await svc.from("courses").delete().in("id", seeded.courses);
  // `tenant_exports` NO tiene DELETE ni para el service_role (es historial, como
  // `certificates`): las filas `done`/`failed` de esta suite quedan, inertes.
});

describe("tenant-export-service — encolar (task 5.13)", () => {
  let firstExportId = "";

  it("coordinator => forbidden; otec_admin encola pending; un segundo pedido => already_running", async () => {
    const forbidden = await requestExport(coordinator);
    expect(forbidden).toEqual({ ok: false, error: "forbidden" });

    const first = await requestExport(admin);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    firstExportId = first.id;

    const second = await requestExport(admin);
    expect(second).toEqual({ ok: false, error: "already_running" });

    const rows = await listExports(admin);
    const row = rows.find((r) => r.id === firstExportId);
    expect(row?.status).toBe("pending");

    // El coordinador no ve la lista (ni la propia solicitud del admin).
    expect(await listExports(coordinator)).toEqual([]);
  });

  it("runTenantExportTick procesa el pending: fila done, ZIP con datasets del tenant y CERO filas del tenant B", async () => {
    const enrollmentB = await makeTenantBEnrollment();

    const { summary, sent } = await tick();
    expect(summary.claimed).toBe(true);
    expect(summary.status).toBe("done");
    expect(summary.exportId).toBe(firstExportId);

    const rows = await listExports(admin);
    const done = rows.find((r) => r.id === firstExportId);
    expect(done?.status).toBe("done");
    expect(done!.fileSize).toBeGreaterThan(0);
    expect(done!.counts.enrollments).toBeGreaterThanOrEqual(3); // el seed de TENANT_A trae 3

    // Descarga REAL desde el bucket con el service client (no un stub).
    const dl = await svc.storage.from("exports").download(`${TENANT_A}/${firstExportId}.zip`);
    expect(dl.error).toBeNull();
    const zip = await JSZip.loadAsync(await dl.data!.arrayBuffer());
    const names = Object.keys(zip.files);
    expect(names).toContain("manifest.json");
    expect(names).toContain("datasets/enrollments.csv");
    expect(names).toContain("datasets/enrollments.json");

    // Aserción de CONTENIDO (no solo de status): filas del tenant, y CERO del B.
    const enrollmentsJson = JSON.parse(await zip.file("datasets/enrollments.json")!.async("string")) as { id: string; tenant_id: string }[];
    expect(enrollmentsJson.length).toBeGreaterThan(0);
    expect(enrollmentsJson.every((r) => r.tenant_id === TENANT_A), "el runner cruzó tenants en el JSON").toBe(true);
    expect(enrollmentsJson.some((r) => r.id === enrollmentB), "fuga: el JSON trae la inscripción del tenant B").toBe(false);

    const enrollmentsCsv = await zip.file("datasets/enrollments.csv")!.async("string");
    expect(enrollmentsCsv, "fuga: el CSV trae la inscripción del tenant B").not.toContain(enrollmentB);
    expect(enrollmentsCsv, "fuga: el CSV trae el tenant_id de B").not.toContain(TENANT_B);

    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as {
      schemaVersion: number; tenantSlug: string; datasets: Record<string, number>; unattributedSenceEvents: number;
    };
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.tenantSlug).toBe("seminarea");
    expect(manifest.datasets.enrollments).toBe(enrollmentsJson.length);
    // Hallazgo MED: el evento sence_events sin atribuir (tenant_id NULL, seed
    // del beforeAll) nunca puede aparecer en un export de tenant (no tiene
    // ninguno), pero el manifiesto SÍ debe dejar constancia de que existe —
    // nunca una omisión silenciosa e indistinguible de "no hay".
    expect(manifest.unattributedSenceEvents, "el manifiesto debe declarar los sence_events sin atribuir").toBeGreaterThanOrEqual(1);

    // Descarga vía el servicio (signed URL firmada tras verificar tenant + done).
    const url = await getExportDownloadUrl(admin, firstExportId);
    expect(url).toContain("http");
    expect(await getExportDownloadUrl(coordinator, firstExportId), "coordinator no debe poder firmar la descarga").toBeNull();

    // Notificación in-app + correo best-effort.
    const { data: notif } = await svc.from("notifications").select("payload").eq("tenant_id", TENANT_A).eq("user_id", admin.userId).eq("kind", "export.ready");
    expect((notif ?? []).some((n) => (n.payload as { exportId?: string }).exportId === firstExportId)).toBe(true);
    expect(sent.length).toBeGreaterThan(0);
  });

  it("un fallo de storage deja la fila failed + notification export.failed (y no reescribe un done)", async () => {
    const req = await requestExport(admin);
    expect(req.ok).toBe(true);
    if (!req.ok) return;

    // "Storage roto": se vacía y borra el bucket antes del tick, forzando el
    // upload a fallar. Se restaura SIEMPRE en el `finally` (estado global
    // compartido con el resto de la suite de integración).
    await svc.storage.emptyBucket("exports");
    await svc.storage.deleteBucket("exports");
    try {
      const { summary } = await tick();
      expect(summary.claimed).toBe(true);
      expect(summary.status).toBe("failed");

      const rows = await listExports(admin);
      const failed = rows.find((r) => r.id === req.id);
      expect(failed?.status).toBe("failed");
      expect(failed?.error).toBeTruthy();
      expect(failed?.error!.length).toBeLessThanOrEqual(500);

      const { data: notif } = await svc.from("notifications").select("id").eq("tenant_id", TENANT_A).eq("user_id", admin.userId).eq("kind", "export.failed");
      expect((notif ?? []).length).toBeGreaterThan(0);

      // El export anterior (Test 2) sigue `done`: el fallo de éste no lo tocó.
      const previouslyDone = rows.find((r) => r.id === firstExportId);
      expect(previouslyDone?.status).toBe("done");
    } finally {
      await svc.storage.createBucket("exports", EXPORTS_BUCKET_CONFIG);
    }
  });
});

describe("tenant-export-runner — reclamo de filas 'running' huérfanas (hallazgo MED de 4-ojos: worker caído a medio proceso bloqueaba el tenant para siempre)", () => {
  // Tenants FICTICIOS propios y dedicados (con `upsert`, no crecen entre
  // corridas): así el reclamo de `running` estancada no compite con las filas
  // pending/running que manejan los tests de arriba sobre TENANT_A/TENANT_B.
  // `tenant_exports` no tiene DELETE (ni para service_role, es historial), así
  // que las filas que este bloque crea (con `randomUUID` para no chocar con
  // el índice único parcial entre corridas) quedan, inertes, como el resto.
  const STALE_TENANT = "44444444-4444-4444-8444-444444444444";
  const FRESH_TENANT = "55555555-5555-4555-8555-555555555555";

  beforeAll(async () => {
    await svc.from("tenants").upsert([
      { id: STALE_TENANT, slug: "export-stale-huerfana-test", name: "OTEC export huérfano (test)" },
      { id: FRESH_TENANT, slug: "export-fresca-test", name: "OTEC export fresco (test)" },
    ]);
    // Idempotencia entre corridas LOCALES repetidas (sin `db reset` de por
    // medio): si una corrida anterior dejó una fila pending/running de estos
    // tenants de test (p.ej. la fresca, que a propósito queda intacta), libera
    // el índice único parcial antes de sembrar la fixture de esta corrida.
    await svc.from("tenant_exports").update({ status: "done", finished_at: new Date().toISOString() })
      .in("tenant_id", [STALE_TENANT, FRESH_TENANT]).in("status", ["pending", "running"]);
  });

  it("una fila 'running' de hace más de 1h se reclama y se procesa igual que un pending", async () => {
    const staleExportId = randomUUID();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const seed = await svc.from("tenant_exports").insert({
      id: staleExportId, tenant_id: STALE_TENANT, requested_by: admin.userId, status: "running", started_at: twoHoursAgo,
    });
    expect(seed.error).toBeNull();

    // Puede haber pending/running de OTRO tenant en vuelo (BD compartida entre
    // worktrees): se insiste hasta llegar a la fila propia, o falla con una
    // señal clara si nunca aparece (en vez de un falso positivo silencioso).
    let reached = false;
    for (let i = 0; i < 25 && !reached; i++) {
      const { summary } = await tick();
      expect(summary.claimed, "nada que reclamar antes de llegar a la fila huérfana propia").toBe(true);
      if (summary.exportId === staleExportId) reached = true;
    }
    expect(reached, "la fila running huérfana nunca se reclamó tras 25 intentos").toBe(true);

    const { data } = await svc.from("tenant_exports").select("status, started_at").eq("id", staleExportId).single();
    expect(data!.status, "una fila running huérfana reclamada nunca debe quedar de nuevo en running para siempre").not.toBe("running");
    expect(["done", "failed"]).toContain(data!.status as string);
  });

  it("una fila 'running' FRESCA (recién iniciada) NO se reclama: sigue running con el mismo started_at", async () => {
    const freshExportId = randomUUID();
    const justNow = new Date().toISOString();
    const seed = await svc.from("tenant_exports").insert({
      id: freshExportId, tenant_id: FRESH_TENANT, requested_by: admin.userId, status: "running", started_at: justNow,
    });
    expect(seed.error).toBeNull();

    // Unas cuantas vueltas del worker (drenando lo que haya pending/stale de
    // otros tenants) no deben tocar jamás esta fila reciente.
    for (let i = 0; i < 5; i++) {
      const { summary } = await tick();
      if (!summary.claimed) break;
      expect(summary.exportId, "una fila running reciente no debe ser reclamada por otra corrida").not.toBe(freshExportId);
    }

    const { data } = await svc.from("tenant_exports").select("status, started_at").eq("id", freshExportId).single();
    expect(data!.status).toBe("running");
    // Postgres devuelve el timestamptz con offset `+00:00` (no `Z`): se compara
    // por VALOR, no por string exacto.
    expect(new Date(data!.started_at as string).getTime()).toBe(new Date(justNow).getTime());
  });
});
