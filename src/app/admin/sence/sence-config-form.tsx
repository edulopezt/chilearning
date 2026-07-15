"use client";

import { useActionState } from "react";

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
      <label className="flex flex-col gap-1 text-sm">
        {esCL.senceAdmin.rutLabel}
        <input
          name="rutOtec"
          required
          defaultValue={initialRut}
          placeholder="76111111-6"
          className="min-h-11 rounded-md border px-3 text-base"
        />
        <span className="text-muted-foreground text-xs">{esCL.senceAdmin.rutHint}</span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {esCL.senceAdmin.environmentLabel}
        <select
          name="environment"
          defaultValue={initialEnvironment}
          className="min-h-11 rounded-md border px-3 text-base"
        >
          <option value="rcetest">{esCL.senceAdmin.envTest}</option>
          <option value="rce">{esCL.senceAdmin.envProd}</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {esCL.senceAdmin.tokenLabel}
        <input
          name="token"
          type="password"
          autoComplete="off"
          placeholder={tokenConfigured ? "••••••••••••••••" : ""}
          className="min-h-11 rounded-md border px-3 font-mono text-base"
        />
        <span className="text-muted-foreground text-xs">
          {tokenConfigured
            ? esCL.senceAdmin.tokenHintConfigured
            : esCL.senceAdmin.tokenHintNew}
        </span>
        <span className={tokenConfigured ? "text-xs text-green-700 dark:text-green-400" : "text-muted-foreground text-xs"}>
          {tokenConfigured ? esCL.senceAdmin.tokenConfigured : esCL.senceAdmin.tokenMissing}
        </span>
      </label>

      {state?.ok ? (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {esCL.senceAdmin.saved}
        </p>
      ) : null}
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {ERROR_TEXT[state.error] ?? esCL.senceAdmin.errorForbidden}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-md bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 sm:w-auto dark:bg-white dark:text-neutral-900"
      >
        {esCL.senceAdmin.save}
      </button>
    </form>
  );
}
