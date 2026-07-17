"use server";

import { revalidatePath } from "next/cache";

import { getPrincipal } from "@/modules/core/auth/session";
import { requestExport } from "@/modules/reportes/tenant-export-service";

/**
 * Solicita un export completo del tenant (task 5.13, HU-1.5). Sin campos: el
 * servicio ya sabe qué tenant y quién pide (principal). El resultado
 * (`already_running`/`forbidden`) no se muestra como error inline a propósito:
 * la lista de abajo se revalida y el estado real (la fila `pending`/`running`
 * ya existente) queda visible de inmediato.
 */
export async function requestExportAction(): Promise<void> {
  const principal = await getPrincipal();
  if (!principal) return;
  await requestExport(principal);
  revalidatePath("/admin/exportacion");
}
