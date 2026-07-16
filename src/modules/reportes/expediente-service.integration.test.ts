/**
 * Integración del expediente (task 3.12) contra Supabase local: subida al bucket,
 * definitivo inmutable, checklist, y ZIP con manifiesto. Requiere `db reset` +
 * storage-api.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "@/modules/core/domain/rbac";
import { buildExpedienteZip, getDocumentDownloadUrl, getExpediente, markDefinitive, uploadDocument } from "@/modules/reportes/expediente-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const admin: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };
const student: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000005", tenantId: TENANT_A, roles: ["student"] };

const LABELS = { type: "Tipo", title: "Título", status: "Estado", definitive: "Definitivo", date: "Fecha", file: "Archivo" };

let svc: SupabaseClient;
function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}
async function freshAction(): Promise<string> {
  const courseId = randomUUID();
  await svc.from("courses").insert({ id: courseId, tenant_id: TENANT_A, name: "Curso exp", sence: true, cod_sence: "1234567890" });
  const actionId = randomUUID();
  await svc.from("actions").insert({ id: actionId, tenant_id: TENANT_A, course_id: courseId, codigo_accion: `EXP-${randomUUID().slice(0, 6)}`, training_line: 3, environment: "rcetest" });
  return actionId;
}
function pdf(name = "doc.pdf"): { name: string; size: number; type: string; bytes: ArrayBuffer } {
  const bytes = new TextEncoder().encode("%PDF-1.4 expediente").buffer;
  return { name, size: bytes.byteLength, type: "application/pdf", bytes };
}

beforeAll(() => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
});

describe("expediente — subida, definitivo, checklist, ZIP", () => {
  it("sube documentos, marca uno definitivo (inmutable) y arma el ZIP con manifiesto", async () => {
    const actionId = await freshAction();

    const up1 = await uploadDocument(admin, actionId, { docType: "dj", title: "DJ OTEC" }, pdf("dj.pdf"));
    expect(up1.ok).toBe(true);
    const up2 = await uploadDocument(admin, actionId, { docType: "nomina", title: "Nómina" }, pdf("nomina.pdf"));
    expect(up2.ok).toBe(true);
    if (!up1.ok) return;

    // El alumno NO puede subir.
    expect((await uploadDocument(student, actionId, { docType: "dj", title: "x" }, pdf())).ok).toBe(false);
    // Una acción que no es del tenant → rechazada antes de tocar storage (4-ojos MED).
    expect((await uploadDocument(admin, randomUUID(), { docType: "dj", title: "x" }, pdf())).ok).toBe(false);
    // Archivo de tipo no permitido.
    expect((await uploadDocument(admin, actionId, { docType: "otro", title: "x" }, { name: "a.txt", size: 5, type: "text/plain", bytes: new ArrayBuffer(5) })).ok).toBe(false);

    // Checklist (línea 3): 2 de 5 presentes.
    const view = await getExpediente(admin, actionId);
    expect(view!.completeness.total).toBe(5);
    expect(view!.completeness.done).toBe(2);
    expect(view!.documents.length).toBe(2);

    // Descarga individual (auditada).
    expect(await getDocumentDownloadUrl(admin, up1.id)).toContain("http");

    // Marca definitivo → luego no se puede modificar.
    expect((await markDefinitive(admin, up1.id)).ok).toBe(true);
    const upd = await svc.from("action_documents").update({ title: "hack" }).eq("id", up1.id).select("id");
    expect(upd.error).not.toBeNull();

    // ZIP con los 2 documentos + MANIFIESTO.csv.
    const zipResult = await buildExpedienteZip(admin, actionId, LABELS);
    expect(zipResult).not.toBeNull();
    const zip = await JSZip.loadAsync(zipResult!.buffer);
    const names = Object.keys(zip.files);
    expect(names).toContain("MANIFIESTO.csv");
    expect(names.some((n) => n.startsWith("dj/"))).toBe(true);
    expect(names.some((n) => n.startsWith("nomina/"))).toBe(true);
  });
});
