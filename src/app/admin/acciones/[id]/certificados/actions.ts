"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { issueBatch, issueCertificate, revokeCertificate } from "@/modules/certificados/certificates-service";

export async function issueCertificateAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const enrollmentId = String(formData.get("enrollmentId") ?? "");
  const actionId = String(formData.get("actionId") ?? "");
  await issueCertificate(principal, enrollmentId);
  revalidatePath(`/admin/acciones/${actionId}/certificados`);
}

export async function issueBatchAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const actionId = String(formData.get("actionId") ?? "");
  await issueBatch(principal, actionId);
  revalidatePath(`/admin/acciones/${actionId}/certificados`);
}

export async function revokeCertificateAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const certificateId = String(formData.get("certificateId") ?? "");
  const actionId = String(formData.get("actionId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  await revokeCertificate(principal, certificateId, reason);
  revalidatePath(`/admin/acciones/${actionId}/certificados`);
}
