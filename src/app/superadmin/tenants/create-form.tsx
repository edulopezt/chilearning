"use client";

import { useActionState, useState } from "react";

import { esCL } from "@/i18n/es-CL";
import { createTenantAction, type CreateTenantState } from "./actions";

const t = esCL.superadmin;

const ERRORS: Record<string, string> = {
  invalid: t.errorInvalid,
  slug_taken: t.errorSlugTaken,
  failed: t.errorFailed,
  forbidden: t.forbidden,
};

/**
 * Alta de OTEC (task 5.3, HU-1.1). Client component para mostrar el enlace de
 * activación copiable cuando no hay correo configurado (degrade sin RESEND).
 */
export function CreateTenantForm() {
  const [state, formAction, pending] = useActionState<CreateTenantState, FormData>(
    createTenantAction,
    { ok: false },
  );
  const [copied, setCopied] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-lg font-semibold">{t.newTenantHeading}</h2>

      <label className="flex flex-col gap-1 text-sm">
        <span>{t.nameLabel}</span>
        <input type="text" name="name" required maxLength={200} className="min-h-11 rounded-md border px-3" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>{t.slugLabel}</span>
        <input
          type="text"
          name="slug"
          required
          minLength={3}
          maxLength={30}
          pattern="[a-z0-9][a-z0-9-]{1,28}[a-z0-9]"
          className="min-h-11 rounded-md border px-3 font-mono"
        />
        <span className="text-muted-foreground text-xs">{t.slugHint}</span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>{t.rutLabel}</span>
        <input type="text" name="rut" maxLength={12} className="min-h-11 rounded-md border px-3" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>{t.planLabel}</span>
        <select name="plan" defaultValue="standard" className="min-h-11 rounded-md border px-3">
          <option value="standard">{t.planStandard}</option>
          <option value="pro">{t.planPro}</option>
          <option value="enterprise">{t.planEnterprise}</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>{t.adminEmailLabel}</span>
        <input type="email" name="adminEmail" required maxLength={320} className="min-h-11 rounded-md border px-3" />
      </label>

      <button type="submit" disabled={pending} className="min-h-11 rounded-md border px-4 font-medium disabled:opacity-50">
        {pending ? t.creating : t.create}
      </button>

      {state.error ? <p className="text-sm text-red-600">{ERRORS[state.error] ?? t.errorFailed}</p> : null}
      {state.ok ? (
        <div className="flex flex-col gap-2 rounded-md border border-green-300 bg-green-50 p-3 text-sm dark:bg-green-950">
          <p className="font-medium text-green-800 dark:text-green-200">
            {t.createdOk} {state.slug ? <code className="font-mono">{state.slug}</code> : null}
          </p>
          {state.emailSent ? (
            <p>{t.emailSentInfo}</p>
          ) : state.inviteLink ? (
            <div className="flex flex-col gap-1">
              <span>{t.emailNotSent}</span>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800">
                  {state.inviteLink}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(state.inviteLink!);
                    setCopied(true);
                  }}
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
