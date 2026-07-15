"use server";

import { headers } from "next/headers";

import { getPrincipal } from "@/modules/core/auth/session";
import { importEnrollmentsFromCsv, type ImportOutcome, type ImportError } from "@/modules/academico/enrollment-service";

export type ImportActionState =
  | { status: "idle" }
  | { status: "error"; error: ImportError | "no_file" | "no_action" }
  | { status: "done"; outcome: ImportOutcome };

/** Server Action del import de inscripciones (task 1.3). */
export async function importEnrollmentsAction(
  _prev: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error", error: "forbidden" };

  const actionId = String(formData.get("actionId") ?? "");
  if (!actionId) return { status: "error", error: "no_action" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", error: "no_file" };
  }

  const csv = await file.text();
  // El enlace "Ir a mi curso" del correo de bienvenida apunta al host del
  // tenant desde el que importa el admin (mismo subdominio que ve el alumno).
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const courseUrl = host ? `${proto}://${host}/mi-curso` : undefined;

  const result = await importEnrollmentsFromCsv(principal, actionId, csv, { courseUrl });
  if ("error" in result) return { status: "error", error: result.error };
  return { status: "done", outcome: result };
}
