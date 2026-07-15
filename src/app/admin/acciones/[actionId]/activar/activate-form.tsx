"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import type { ActionMutationResult } from "@/modules/academico/action-service";
import { activateWithScheduleAction } from "../../actions";

const t = esCL.actions;

function errorLabel(result: ActionMutationResult): string {
  if (result.ok) return "";
  if ("validation" in result) return result.validation.map((e) => e.message).join(" · ");
  if (result.error === "missing_dates") return t.errMissingDates;
  if (result.error === "code_unchanged") return t.errCodeUnchanged;
  return t.genericError;
}

/**
 * Formulario de activación (task 2.8): pone código nuevo + fechas y activa. Es
 * la ruta de UI para activar una re-ejecución (que nace con el código de origen).
 */
export function ActivateForm({
  actionId,
  currentCode,
  startsOn,
  endsOn,
}: {
  actionId: string;
  currentCode: string;
  startsOn: string | null;
  endsOn: string | null;
}) {
  const [state, formAction, pending] = useActionState<ActionMutationResult | null, FormData>(
    activateWithScheduleAction,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="actionId" value={actionId} />
      <label className="flex flex-col gap-1 text-sm">
        {t.codeLabel}
        <input name="codigoAccion" defaultValue={currentCode} required className="input" />
        <span className="text-muted-foreground text-xs">{t.activateCodeHint}</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          {t.startsLabel}
          <input type="date" name="startsOn" defaultValue={startsOn ?? ""} required className="input" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.endsLabel}
          <input type="date" name="endsOn" defaultValue={endsOn ?? ""} required className="input" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-md bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
        >
          {t.activate}
        </button>
        {state?.ok ? (
          <span className="text-sm text-green-700 dark:text-green-400">{t.activated}</span>
        ) : null}
        {state && !state.ok ? (
          <span role="alert" className="text-sm text-red-600">
            {errorLabel(state)}
          </span>
        ) : null}
      </div>
    </form>
  );
}
