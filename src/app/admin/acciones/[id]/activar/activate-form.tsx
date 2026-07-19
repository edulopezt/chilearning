"use client";

import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldControl, FieldDescription, FieldLabel, FieldRoot } from "@/components/ui/field";
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
      <FieldRoot>
        <FieldLabel>{t.codeLabel}</FieldLabel>
        <FieldControl name="codigoAccion" defaultValue={currentCode} required />
        <FieldDescription>{t.activateCodeHint}</FieldDescription>
      </FieldRoot>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldRoot>
          <FieldLabel>{t.startsLabel}</FieldLabel>
          <FieldControl type="date" name="startsOn" defaultValue={startsOn ?? ""} required />
        </FieldRoot>
        <FieldRoot>
          <FieldLabel>{t.endsLabel}</FieldLabel>
          <FieldControl type="date" name="endsOn" defaultValue={endsOn ?? ""} required />
        </FieldRoot>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          {t.activate}
        </Button>
        {state?.ok ? (
          <Alert variant="success" role="status" className="w-auto">
            <AlertDescription>{t.activated}</AlertDescription>
          </Alert>
        ) : null}
        {state && !state.ok ? (
          <Alert variant="destructive" role="alert" className="w-auto">
            <AlertDescription>{errorLabel(state)}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </form>
  );
}
