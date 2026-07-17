"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { FEATURE_KEYS } from "@/modules/core/domain/features";
import {
  createTenant,
  reactivateTenant,
  setTenantFlags,
  suspendTenant,
} from "@/modules/core/tenant-service";

/** Server Actions del panel de plataforma (task 5.3, HU-1.1/1.4/1.3). */

export interface CreateTenantState {
  readonly ok: boolean;
  readonly slug?: string;
  readonly inviteLink?: string | null;
  readonly emailSent?: boolean;
  readonly error?: string;
}

export async function createTenantAction(
  _prev: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  const principal = await getPrincipal();
  if (!principal) return { ok: false, error: "forbidden" };

  const rut = String(formData.get("rut") ?? "").trim();
  const result = await createTenant(principal, {
    name: String(formData.get("name") ?? "").trim(),
    slug: String(formData.get("slug") ?? "").trim().toLowerCase(),
    plan: String(formData.get("plan") ?? ""),
    adminEmail: String(formData.get("adminEmail") ?? "").trim(),
    rut: rut || null,
  });

  revalidatePath("/superadmin/tenants");
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, slug: result.slug, inviteLink: result.inviteLink, emailSent: result.emailSent };
}

export async function suspendTenantAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  await suspendTenant(principal, String(formData.get("tenantId") ?? ""));
  revalidatePath("/superadmin/tenants");
}

export async function reactivateTenantAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  await reactivateTenant(principal, String(formData.get("tenantId") ?? ""));
  revalidatePath("/superadmin/tenants");
}

export async function updateFlagsAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  const key = String(formData.get("key") ?? "");
  if (!(FEATURE_KEYS as readonly string[]).includes(key)) return;
  const enabled = String(formData.get("enabled") ?? "") === "true";
  await setTenantFlags(principal, String(formData.get("tenantId") ?? ""), { [key]: enabled });
  revalidatePath("/superadmin/tenants");
}
