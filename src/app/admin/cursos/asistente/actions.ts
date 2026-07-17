"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createDraft, descriptorDownloadUrl, discardDraft } from "@/modules/academico/wizard-service";
import { getPrincipal } from "@/modules/core/auth/session";

/** Server Actions del punto de entrada del asistente (task 5.10). */

export type CreateDraftState = { status: "idle" } | { status: "file" } | { status: "error" };

/** Inicia un borrador "desde cero" (con o sin plantilla) y va directo a su primer paso. */
export async function createDraftScratchAction(
  _prev: CreateDraftState,
  formData: FormData,
): Promise<CreateDraftState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error" };

  const templateId = String(formData.get("templateId") ?? "").trim();
  const result = await createDraft(principal, { source: "scratch", templateId: templateId || undefined });
  if (!result.ok) return { status: "error" };

  revalidatePath("/admin/cursos/asistente");
  redirect(`/admin/cursos/asistente/${result.draftId}`);
}

/** Sube un descriptor SENCE (.docx), lo analiza y va directo al primer paso con lo detectado precargado. */
export async function createDraftDescriptorAction(
  _prev: CreateDraftState,
  formData: FormData,
): Promise<CreateDraftState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "file" };
  const bytes = await file.arrayBuffer();

  const result = await createDraft(principal, {
    source: "descriptor",
    file: { name: file.name, type: file.type, size: file.size, bytes },
  });
  if (!result.ok) return { status: result.error === "file_rejected" ? "file" : "error" };

  revalidatePath("/admin/cursos/asistente");
  redirect(`/admin/cursos/asistente/${result.draftId}`);
}

export async function discardDraftAction(draftId: string): Promise<{ ok: boolean }> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false };
  const result = await discardDraft(principal, draftId);
  revalidatePath("/admin/cursos/asistente");
  return { ok: result.ok };
}

/**
 * Signed URL (1h) del descriptor archivado de un borrador — incluidos los ya
 * GENERADOS (4-ojos MED: el CA "descargable después de generar" no se
 * cumplía porque ninguna pantalla exponía este servicio ya existente). El
 * propio `descriptorDownloadUrl` reautoriza contra el tenant del principal.
 */
export async function descriptorDownloadUrlAction(
  draftId: string,
): Promise<{ readonly ok: true; readonly url: string } | { readonly ok: false }> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false };
  const result = await descriptorDownloadUrl(principal, draftId);
  if (!result.ok) return { ok: false };
  return { ok: true, url: result.url };
}
