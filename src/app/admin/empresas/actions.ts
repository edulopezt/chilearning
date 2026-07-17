"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import {
  createCompany,
  inviteCompanyMember,
  revokeCompanyMember,
} from "@/modules/portal-empresa/company-service";

export interface CreateCompanyState {
  readonly ok: boolean;
  readonly error?: string;
}

export interface InviteMemberState {
  readonly ok: boolean;
  readonly inviteLink?: string | null;
  readonly emailSent?: boolean;
  readonly error?: string;
}

export async function createCompanyAction(
  _prev: CreateCompanyState,
  formData: FormData,
): Promise<CreateCompanyState> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "unauthorized" };
  const result = await createCompany(principal, {
    rut: String(formData.get("rut") ?? ""),
    razonSocial: String(formData.get("razonSocial") ?? ""),
  });
  revalidatePath("/admin/empresas");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function inviteCompanyMemberAction(
  _prev: InviteMemberState,
  formData: FormData,
): Promise<InviteMemberState> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "unauthorized" };
  const result = await inviteCompanyMember(principal, {
    companyId: String(formData.get("companyId") ?? ""),
    email: String(formData.get("email") ?? ""),
  });
  revalidatePath("/admin/empresas");
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, inviteLink: result.inviteLink, emailSent: result.emailSent };
}

export async function revokeCompanyMemberAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  await revokeCompanyMember(principal, String(formData.get("memberId") ?? ""));
  revalidatePath("/admin/empresas");
}
