"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { createAnnouncement, publishAnnouncement } from "@/modules/comunicacion/announcement-service";
import { createCalendarItem, deleteCalendarItem } from "@/modules/comunicacion/calendar-service";
import { resolveThread, addPost } from "@/modules/comunicacion/forum-service";
import { generateReplyDraft } from "@/modules/comunicacion/draft-service";

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function createAnnouncementAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const courseId = String(formData.get("courseId") ?? "");
  await createAnnouncement(principal, { title: formData.get("title"), body: formData.get("body"), courseId });
  revalidatePath(`/admin/cursos/${courseId}/comunicacion`);
}

export async function publishAnnouncementAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const courseId = String(formData.get("courseId") ?? "");
  const id = String(formData.get("announcementId") ?? "");
  await publishAnnouncement(principal, id, `${await origin()}/mi-curso/comunicacion`);
  revalidatePath(`/admin/cursos/${courseId}/comunicacion`);
}

export async function createCalItemAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const courseId = String(formData.get("courseId") ?? "");
  await createCalendarItem(principal, courseId, {
    kind: formData.get("kind"), title: formData.get("title"), description: formData.get("description"), dueAt: formData.get("dueAt"),
  });
  revalidatePath(`/admin/cursos/${courseId}/comunicacion`);
}

export async function deleteCalItemAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const courseId = String(formData.get("courseId") ?? "");
  await deleteCalendarItem(principal, String(formData.get("itemId") ?? ""));
  revalidatePath(`/admin/cursos/${courseId}/comunicacion`);
}

export async function resolveThreadAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const courseId = String(formData.get("courseId") ?? "");
  await resolveThread(principal, String(formData.get("threadId") ?? ""), formData.get("resolved") === "true");
  revalidatePath(`/admin/cursos/${courseId}/comunicacion/foro/${formData.get("threadId")}`);
  revalidatePath(`/admin/cursos/${courseId}/comunicacion`);
}

export async function staffReplyAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const courseId = String(formData.get("courseId") ?? "");
  const threadId = String(formData.get("threadId") ?? "");
  await addPost(principal, threadId, { body: formData.get("body") }, `${await origin()}/mi-curso/comunicacion/foro/${threadId}`);
  revalidatePath(`/admin/cursos/${courseId}/comunicacion/foro/${threadId}`);
}

/** Borrador de IA para la respuesta del staff en el foro (task 5.9, HU-9.5).
 *  Llamado directamente desde el cliente (`AiDraftButton`), no por un `<form>`. */
export async function generateForumDraftAction(
  threadId: string,
): Promise<{ ok: true; draft: string } | { ok: false; error: string }> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "forbidden" };
  return generateReplyDraft(principal, "forum", threadId);
}
