"use client";

import { useActionState, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldControl, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { esCL } from "@/i18n/es-CL";
import { createGrantAction, type InviteState } from "./actions";

const t = esCL.supervisorGrants;

interface ActionOption {
  readonly actionId: string;
  readonly codigoAccion: string;
  readonly courseName: string;
}

const ERRORS: Record<string, string> = {
  invalid: t.errorInvalid,
  scope_out_of_tenant: t.errorScope,
  failed: t.errorFailed,
  forbidden: t.forbidden,
};

/**
 * Formulario de invitación de fiscalizador (task 3.11). Client component para
 * mostrar el enlace de acceso devuelto cuando no hay correo configurado (degrade).
 */
export function InviteForm({ actions }: { actions: readonly ActionOption[] }) {
  const [state, formAction, pending] = useActionState<InviteState, FormData>(createGrantAction, { ok: false });
  const [scope, setScope] = useState<"tenant" | "actions">("tenant");
  const [copied, setCopied] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-md border p-4">
      <h2 className="text-lg font-semibold">{t.inviteHeading}</h2>

      <FieldRoot>
        <FieldLabel>{t.email}</FieldLabel>
        <FieldControl type="email" name="email" required />
      </FieldRoot>

      <FieldRoot>
        <FieldLabel>{t.scope}</FieldLabel>
        <Select name="scope" value={scope} onValueChange={(value) => setScope(value as "tenant" | "actions")}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tenant">{t.scopeTenant}</SelectItem>
            <SelectItem value="actions">{t.scopeActions}</SelectItem>
          </SelectContent>
        </Select>
      </FieldRoot>

      {scope === "actions" ? (
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1 font-medium">{t.pickActions}</legend>
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border p-2">
            {actions.length === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              actions.map((a) => (
                <Label key={a.actionId} className="font-normal">
                  <Checkbox name="actionIds" value={a.actionId} />
                  <span className="font-mono text-xs">{a.codigoAccion}</span>
                  <span className="truncate text-muted-foreground">{a.courseName}</span>
                </Label>
              ))
            )}
          </div>
        </fieldset>
      ) : null}

      <FieldRoot>
        <FieldLabel>{t.expiresOn}</FieldLabel>
        <FieldControl type="date" name="expiresOn" />
      </FieldRoot>

      <Button type="submit" loading={pending}>
        {t.invite}
      </Button>

      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{ERRORS[state.error] ?? t.errorFailed}</AlertDescription>
        </Alert>
      ) : null}
      {state.ok ? (
        <Alert variant="success" role="status">
          <div className="flex flex-1 flex-col gap-2">
            <AlertTitle>{t.inviteOk}</AlertTitle>
            {state.emailSent ? (
              <AlertDescription>{t.emailSent}</AlertDescription>
            ) : state.inviteLink ? (
              <AlertDescription>
                <div className="flex flex-col gap-1">
                  <span>{t.emailNotSent}</span>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{state.inviteLink}</code>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => { void navigator.clipboard.writeText(state.inviteLink!); setCopied(true); }}
                    >
                      {copied ? "✓" : t.copy}
                    </Button>
                  </div>
                </div>
              </AlertDescription>
            ) : null}
          </div>
        </Alert>
      ) : null}
    </form>
  );
}
