"use server";

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
  const result = await importEnrollmentsFromCsv(principal, actionId, csv);
  if ("error" in result) return { status: "error", error: result.error };
  return { status: "done", outcome: result };
}
