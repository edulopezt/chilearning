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

beforeAll(() => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
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
      schemaVersion: number; tenantSlug: string; datasets: Record<string, number>;
    };
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.tenantSlug).toBe("seminarea");
    expect(manifest.datasets.enrollments).toBe(enrollmentsJson.length);

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
