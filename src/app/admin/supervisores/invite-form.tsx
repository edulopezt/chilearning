"use client";

import { useActionState, useState } from "react";

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
    <form action={formAction} className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-lg font-semibold">{t.inviteHeading}</h2>

      <label className="flex flex-col gap-1 text-sm">
        <span>{t.email}</span>
        <input type="email" name="email" required className="min-h-11 rounded-md border px-3" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>{t.scope}</span>
        <select name="scope" value={scope} onChange={(e) => setScope(e.target.value as "tenant" | "actions")} className="min-h-11 rounded-md border px-3">
          <option value="tenant">{t.scopeTenant}</option>
          <option value="actions">{t.scopeActions}</option>
        </select>
      </label>

      {scope === "actions" ? (
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1">{t.pickActions}</legend>
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border p-2">
            {actions.length === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              actions.map((a) => (
                <label key={a.actionId} className="flex items-center gap-2">
                  <input type="checkbox" name="actionIds" value={a.actionId} className="size-4" />
                  <span className="font-mono text-xs">{a.codigoAccion}</span>
                  <span className="text-muted-foreground truncate">{a.courseName}</span>
                </label>
              ))
            )}
          </div>
        </fieldset>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span>{t.expiresOn}</span>
        <input type="date" name="expiresOn" className="min-h-11 rounded-md border px-3" />
      </label>

      <button type="submit" disabled={pending} className="min-h-11 rounded-md border px-4 font-medium disabled:opacity-50">
        {t.invite}
      </button>

      {state.error ? <p className="text-sm text-red-600">{ERRORS[state.error] ?? t.errorFailed}</p> : null}
      {state.ok ? (
        <div className="flex flex-col gap-2 rounded-md border border-green-300 bg-green-50 p-3 text-sm dark:bg-green-950">
          <p className="font-medium text-green-800 dark:text-green-200">{t.inviteOk}</p>
          {state.emailSent ? (
            <p>{t.emailSent}</p>
          ) : state.inviteLink ? (
            <div className="flex flex-col gap-1">
              <span>{t.emailNotSent}</span>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800">{state.inviteLink}</code>
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard.writeText(state.inviteLink!); setCopied(true); }}
                  className="min-h-11 rounded-md border px-3 text-xs"
                >
                  {copied ? "✓" : t.copy}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
