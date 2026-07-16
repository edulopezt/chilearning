"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { applyErasure, resolveDsr } from "@/modules/core/privacy-service";

export async function resolveDsrAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const id = String(formData.get("requestId") ?? "");
  const status = formData.get("status") === "rejected" ? "rejected" : "completed";
  await resolveDsr(principal, id, status, String(formData.get("note") ?? ""));
  revalidatePath("/admin/derechos");
}

export async function applyErasureAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  await applyErasure(principal, String(formData.get("requestId") ?? ""));
  revalidatePath("/admin/derechos");
}
