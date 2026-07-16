"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { markDefinitive, uploadDocument } from "@/modules/reportes/expediente-service";

export type ExpedienteState = { status: "idle" } | { status: "ok" } | { status: "error" } | { status: "file" };

export async function uploadDocumentAction(_prev: ExpedienteState, formData: FormData): Promise<ExpedienteState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error" };
  const actionId = String(formData.get("actionId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "file" };
  const bytes = await file.arrayBuffer();
  const res = await uploadDocument(
    principal,
    actionId,
    { docType: formData.get("docType"), title: formData.get("title"), documentDate: formData.get("documentDate") },
    { name: file.name, size: file.size, type: file.type, bytes },
  );
  if (res.ok) {
    revalidatePath(`/admin/acciones/${actionId}/expediente`);
    return { status: "ok" };
  }
  return { status: res.error === "file" ? "file" : "error" };
}

export async function markDefinitiveAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const actionId = String(formData.get("actionId") ?? "");
  await markDefinitive(principal, String(formData.get("documentId") ?? ""));
  revalidatePath(`/admin/acciones/${actionId}/expediente`);
}
