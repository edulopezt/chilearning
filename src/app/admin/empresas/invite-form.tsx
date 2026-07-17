"use client";

import { useActionState, useState } from "react";

import { esCL } from "@/i18n/es-CL";
import {
  createCompanyAction,
  inviteCompanyMemberAction,
  type CreateCompanyState,
  type InviteMemberState,
} from "./actions";

const t = esCL.companies;

const ERRORS: Record<string, string> = {
  invalid: t.errorInvalid,
  duplicate: t.errorDuplicate,
  company_not_found: t.errorCompanyNotFound,
  failed: t.errorFailed,
  forbidden: t.forbidden,
};

interface CompanyOption {
  readonly id: string;
  readonly razonSocial: string;
  readonly rut: string;
}

/**
 * Alta de empresa (task 5.2). Client component solo para reportar el error de
 * validación del RUT sin recargar; el servicio revalida igual en el servidor.
 */
export function CreateCompanyForm() {
  const [state, formAction, pending] = useActionState<CreateCompanyState, FormData>(createCompanyAction, {
    ok: false,
  });

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-lg font-semibold">{t.createHeading}</h2>

      <label className="flex flex-col gap-1 text-sm">
        <span>{t.rut}</span>
        <input name="rut" required inputMode="text" className="min-h-11 rounded-md border px-3" />
        <span className="text-muted-foreground text-xs">{t.rutHint}</span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>{t.razonSocial}</span>
        <input name="razonSocial" required maxLength={200} className="min-h-11 rounded-md border px-3" />
      </label>

      <button type="submit" disabled={pending} className="min-h-11 rounded-md border px-4 font-medium disabled:opacity-50">
        {t.create}
      </button>

      {state.error ? <p className="text-sm text-red-600">{ERRORS[state.error] ?? t.errorFailed}</p> : null}
      {state.ok ? <p className="text-sm text-green-700 dark:text-green-400">{t.createOk}</p> : null}
    </form>
  );
}

/**
 * Invitación de RRHH (task 5.2) — espejo del formulario del fiscalizador:
 * muestra el enlace de acceso devuelto cuando no hay correo configurado.
 */
export function InviteForm({ companies }: { companies: readonly CompanyOption[] }) {
  const [state, formAction, pending] = useActionState<InviteMemberState, FormData>(inviteCompanyMemberAction, {
    ok: false,
  });
  const [copied, setCopied] = useState(false);

  if (companies.length === 0) {
    return (
      <div className="rounded-md border p-4">
        <h2 className="text-lg font-semibold">{t.inviteHeading}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t.noCompanies}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-lg font-semibold">{t.inviteHeading}</h2>

      <label className="flex flex-col gap-1 text-sm">
        <span>{t.company}</span>
        <select name="companyId" required className="min-h-11 rounded-md border px-3">
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.razonSocial} · {c.rut}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>{t.email}</span>
        <input type="email" name="email" required className="min-h-11 rounded-md border px-3" />
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
