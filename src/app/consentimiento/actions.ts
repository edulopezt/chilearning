"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getPrincipal } from "@/modules/core/auth/session";
import { recordConsent } from "@/modules/core/privacy-service";

export async function acceptConsentAction(): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;
  await recordConsent(principal, ip);
  redirect("/mi-curso");
}
