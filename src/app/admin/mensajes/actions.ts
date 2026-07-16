"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { sendMessage } from "@/modules/comunicacion/message-service";

export async function staffSendMessageAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const threadId = String(formData.get("threadId") ?? "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  await sendMessage(principal, threadId, { body: formData.get("body") }, `${proto}://${host}/mi-curso/comunicacion/mensaje/${threadId}`);
  revalidatePath(`/admin/mensajes/${threadId}`);
}
