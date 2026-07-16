"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { addPost, createThread } from "@/modules/comunicacion/forum-service";
import { sendMessage, startThread } from "@/modules/comunicacion/message-service";

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function createThreadAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const courseId = String(formData.get("courseId") ?? "");
  await createThread(principal, courseId, { title: formData.get("title"), body: formData.get("body") });
  revalidatePath("/mi-curso/comunicacion");
}

export async function addPostAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const threadId = String(formData.get("threadId") ?? "");
  await addPost(principal, threadId, { body: formData.get("body") }, `${await origin()}/mi-curso/comunicacion/foro/${threadId}`);
  revalidatePath(`/mi-curso/comunicacion/foro/${threadId}`);
}

export async function startMessageAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const courseId = String(formData.get("courseId") ?? "");
  await startThread(principal, courseId, { subject: formData.get("subject"), body: formData.get("body") });
  revalidatePath("/mi-curso/comunicacion");
}

export async function sendMessageAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const threadId = String(formData.get("threadId") ?? "");
  await sendMessage(principal, threadId, { body: formData.get("body") }, `${await origin()}/mi-curso/comunicacion/mensaje/${threadId}`);
  revalidatePath(`/mi-curso/comunicacion/mensaje/${threadId}`);
}
