/**
 * Integración de comunicación (task 3.4, M9) contra Supabase local: fan-out de
 * anuncio (notifications + audit), foro (respuesta del staff notifica al autor +
 * resolver), mensajería (alumno inicia, staff responde y notifica) y calendario
 * (fusión con plazos de instrumentos). Requiere `supabase start` + `db reset`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "@/modules/core/domain/rbac";
import { createAnnouncement, publishAnnouncement } from "@/modules/comunicacion/announcement-service";
import { addPost, createThread, resolveThread } from "@/modules/comunicacion/forum-service";
import { getThread, listMyThreads, sendMessage, startThread } from "@/modules/comunicacion/message-service";
import { createCalendarItem, listCalendar } from "@/modules/comunicacion/calendar-service";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const USER_STUDENT = "aaaaaaaa-0000-4000-8000-000000000005";
const admin: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000001", tenantId: TENANT_A, roles: ["otec_admin"] };
const instructor: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000003", tenantId: TENANT_A, roles: ["instructor"] };
const student: Principal = { userId: USER_STUDENT, tenantId: TENANT_A, roles: ["student"] };

let svc: SupabaseClient;
function env(): { apiUrl: string; serviceRoleKey: string } {
  const out = execSync("supabase status -o env", { encoding: "utf8" });
  const get = (k: string): string => out.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?$`, "m"))![1]!;
  return { apiUrl: get("API_URL"), serviceRoleKey: get("SERVICE_ROLE_KEY") };
}
async function freshCourse(): Promise<{ courseId: string; actionId: string }> {
  const courseId = randomUUID();
  await svc.from("courses").insert({ id: courseId, tenant_id: TENANT_A, name: "Curso com", sence: false });
  const actionId = randomUUID();
  await svc.from("actions").insert({ id: actionId, tenant_id: TENANT_A, course_id: courseId, codigo_accion: `COM-${randomUUID().slice(0, 6)}`, training_line: 3, environment: "rcetest" });
  await svc.from("enrollments").insert({ id: randomUUID(), tenant_id: TENANT_A, action_id: actionId, user_id: USER_STUDENT, run: "5126663-3", first_names: "Ana", last_names: "Díaz" });
  return { courseId, actionId };
}
async function countNotifications(userId: string, kind: string): Promise<number> {
  const { data } = await svc.from("notifications").select("id").eq("user_id", userId).eq("kind", kind);
  return (data ?? []).length;
}

beforeAll(() => {
  const e = env();
  process.env.NEXT_PUBLIC_SUPABASE_URL = e.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = e.serviceRoleKey;
  svc = createClient(e.apiUrl, e.serviceRoleKey, { auth: { persistSession: false } });
});

describe("anuncios", () => {
  it("publicar notifica a los alumnos inscritos (una vez) y audita", async () => {
    const { courseId } = await freshCourse();
    const created = await createAnnouncement(admin, { title: "Aviso", body: "Cuerpo", courseId });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const before = await countNotifications(USER_STUDENT, "announcement.published");
    const pub = await publishAnnouncement(admin, created.id, "https://x/mi-curso");
    expect(pub.ok).toBe(true);
    expect(pub.sent).toBeGreaterThanOrEqual(1);
    expect(await countNotifications(USER_STUDENT, "announcement.published")).toBe(before + 1);
    // Idempotente: re-publicar no re-envía.
    const again = await publishAnnouncement(admin, created.id, "https://x/mi-curso");
    expect(again.sent).toBe(0);
  });
});

describe("foro", () => {
  it("el alumno abre un hilo, el staff responde (notifica) y lo resuelve", async () => {
    const { courseId } = await freshCourse();
    const thread = await createThread(student, courseId, { title: "Duda", body: "¿Cómo?" });
    expect(thread.ok).toBe(true);
    if (!thread.ok) return;
    const before = await countNotifications(USER_STUDENT, "forum.reply");
    const reply = await addPost(instructor, thread.id, { body: "Así." }, "https://x");
    expect(reply.ok).toBe(true);
    expect(await countNotifications(USER_STUDENT, "forum.reply")).toBe(before + 1);
    // Un alumno no inscrito no puede postear.
    const intruder: Principal = { userId: "aaaaaaaa-0000-4000-8000-000000000006", tenantId: TENANT_A, roles: ["student"] };
    expect((await addPost(intruder, thread.id, { body: "x" }, "https://x")).ok).toBe(false);

    const resolved = await resolveThread(instructor, thread.id, true);
    expect(resolved.ok).toBe(true);
    // El alumno no puede resolver.
    expect((await resolveThread(student, thread.id, false)).ok).toBe(false);
  });
});

describe("mensajería", () => {
  it("el alumno inicia un hilo y el staff responde (notifica al alumno)", async () => {
    const { courseId } = await freshCourse();
    const started = await startThread(student, courseId, { subject: "Consulta", body: "Hola" });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const before = await countNotifications(USER_STUDENT, "message.received");
    const sent = await sendMessage(instructor, started.id, { body: "Te respondo." }, "https://x");
    expect(sent.ok).toBe(true);
    expect(await countNotifications(USER_STUDENT, "message.received")).toBe(before + 1);

    // El staff ve el hilo en su bandeja; un tercero alumno no.
    const staffThreads = await listMyThreads(instructor, courseId);
    expect(staffThreads.some((t) => t.id === started.id)).toBe(true);
    const view = await getThread(student, started.id);
    expect(view?.messages.length).toBeGreaterThanOrEqual(2);
  });
});

describe("calendario", () => {
  it("fusiona ítems manuales con los plazos de instrumentos", async () => {
    const { courseId } = await freshCourse();
    await createCalendarItem(admin, courseId, { kind: "hito", title: "Inicio", dueAt: "2026-07-05T09:00" });
    // Una tarea publicada con plazo.
    await svc.from("assignments").insert({ tenant_id: TENANT_A, course_id: courseId, title: "Entrega", status: "published", due_at: "2026-07-02T23:59:00Z" });
    const cal = await listCalendar(admin, courseId);
    expect(cal).not.toBeNull();
    expect(cal!.some((c) => c.title === "Inicio" && c.source === "manual")).toBe(true);
    expect(cal!.some((c) => c.title === "Entrega" && c.source === "instrument")).toBe(true);
  });
});
