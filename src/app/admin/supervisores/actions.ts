"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { createGrant, revokeGrant } from "@/modules/portal-empresa/supervisor-grant-service";

export interface InviteState {
  readonly ok: boolean;
  readonly inviteLink?: string | null;
  readonly emailSent?: boolean;
  readonly error?: string;
}

export async function createGrantAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "unauthorized" };
  const scope = String(formData.get("scope") ?? "tenant");
  const actionIds = formData.getAll("actionIds").map(String).filter(Boolean);
  const expiresOn = String(formData.get("expiresOn") ?? "").trim() || null;
  const result = await createGrant(principal, {
    email: String(formData.get("email") ?? "").trim(),
    scope,
    actionIds,
    expiresOn,
  });
  revalidatePath("/admin/supervisores");
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, inviteLink: result.inviteLink, emailSent: result.emailSent };
}

export async function revokeGrantAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  await revokeGrant(principal, String(formData.get("grantId") ?? ""));
  revalidatePath("/admin/supervisores");
}
