"use client";

import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldControl, FieldDescription, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { esCL } from "@/i18n/es-CL";
import type { ExpiryConfigResult } from "@/modules/certificados/expiry-config-service";
import { updateExpiryConfigAction } from "./actions";

const t = esCL.certExpiry;

/** Config de alertas (offsets + on/off). Único formulario de esta pantalla. */
export function ExpiryConfigForm({
  offsetsDays,
  enabled,
  isDefault,
}: {
  offsetsDays: readonly number[];
  enabled: boolean;
  isDefault: boolean;
}) {
  const [state, formAction, pending] = useActionState<ExpiryConfigResult | null, FormData>(
    updateExpiryConfigAction,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t.configTitle}</h2>
        <p className="text-muted-foreground text-sm">{t.configIntro}</p>
        {isDefault ? <p className="text-muted-foreground text-xs">{t.configDefaultNote}</p> : null}
      </div>

      <FieldRoot className="max-w-xs">
        <FieldLabel>{t.configOffsets}</FieldLabel>
        <FieldControl name="offsetsDays" defaultValue={offsetsDays.join(", ")} inputMode="numeric" />
        <FieldDescription>{t.configOffsetsHint}</FieldDescription>
      </FieldRoot>

      <Label>
        <Checkbox name="enabled" value="true" defaultChecked={enabled} />
        {t.configEnabled}
      </Label>

      {state?.ok ? (
        <Alert variant="success" role="status">
          <AlertDescription>{t.configSaved}</AlertDescription>
        </Alert>
      ) : null}
      {state && !state.ok ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error === "invalid_offsets" ? t.configOffsetsError : t.configError}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" loading={pending} className="w-full sm:w-auto">
        {t.configSave}
      </Button>
    </form>
  );
}
