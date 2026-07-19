"use client";

import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldControl, FieldDescription, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { esCL } from "@/i18n/es-CL";
import type { SaveResult, SenceEnvironment } from "@/modules/core/sence-config";
import { saveSenceConfigAction } from "./actions";

const ERROR_TEXT: Record<string, string> = {
  invalid_rut: esCL.senceAdmin.errorRut,
  invalid_token: esCL.senceAdmin.errorToken,
  forbidden: esCL.senceAdmin.errorForbidden,
  no_tenant: esCL.senceAdmin.errorForbidden,
};

export function SenceConfigForm({
  initialRut,
  initialEnvironment,
  tokenConfigured,
}: {
  initialRut: string;
  initialEnvironment: SenceEnvironment;
  tokenConfigured: boolean;
}) {
  const [state, formAction, pending] = useActionState<SaveResult | null, FormData>(
    saveSenceConfigAction,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FieldRoot>
        <FieldLabel>{esCL.senceAdmin.rutLabel}</FieldLabel>
        <FieldControl name="rutOtec" required defaultValue={initialRut} placeholder="76111111-6" />
        <FieldDescription>{esCL.senceAdmin.rutHint}</FieldDescription>
      </FieldRoot>

      <FieldRoot>
        <FieldLabel>{esCL.senceAdmin.environmentLabel}</FieldLabel>
        <Select name="environment" defaultValue={initialEnvironment}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rcetest">{esCL.senceAdmin.envTest}</SelectItem>
            <SelectItem value="rce">{esCL.senceAdmin.envProd}</SelectItem>
          </SelectContent>
        </Select>
      </FieldRoot>

      <FieldRoot>
        <FieldLabel>{esCL.senceAdmin.tokenLabel}</FieldLabel>
        <FieldControl
          name="token"
          type="password"
          autoComplete="off"
          placeholder={tokenConfigured ? "••••••••••••••••" : ""}
          className="font-mono"
        />
        <FieldDescription>
          {tokenConfigured ? esCL.senceAdmin.tokenHintConfigured : esCL.senceAdmin.tokenHintNew}
        </FieldDescription>
        <span className={tokenConfigured ? "text-xs text-success" : "text-xs text-muted-foreground"}>
          {tokenConfigured ? esCL.senceAdmin.tokenConfigured : esCL.senceAdmin.tokenMissing}
        </span>
      </FieldRoot>

      {state?.ok ? (
        <Alert variant="success" role="status">
          <AlertDescription>{esCL.senceAdmin.saved}</AlertDescription>
        </Alert>
      ) : null}
      {state && !state.ok ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{ERROR_TEXT[state.error] ?? esCL.senceAdmin.errorForbidden}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" loading={pending} className="w-full sm:w-auto">
        {esCL.senceAdmin.save}
      </Button>
    </form>
  );
}
