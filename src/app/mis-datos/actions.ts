"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { requestDsr } from "@/modules/core/privacy-service";

export async function requestDsrAction(formData: FormData): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  await requestDsr(principal, { kind: formData.get("kind"), detail: formData.get("detail") });
  revalidatePath("/mis-datos");
}
