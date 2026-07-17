"use client";

import { useActionState } from "react";

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

      <label className="flex flex-col gap-1 text-sm">
        {t.configOffsets}
        <input
          name="offsetsDays"
          defaultValue={offsetsDays.join(", ")}
          inputMode="numeric"
          className="min-h-11 w-full max-w-xs rounded-md border px-3 text-base"
        />
        <span className="text-muted-foreground text-xs">{t.configOffsetsHint}</span>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input name="enabled" type="checkbox" defaultChecked={enabled} className="size-4" />
        {t.configEnabled}
      </label>

      {state?.ok ? (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {t.configSaved}
        </p>
      ) : null}
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error === "invalid_offsets" ? t.configOffsetsError : t.configError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-md bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 sm:w-auto dark:bg-white dark:text-neutral-900"
      >
        {t.configSave}
      </button>
    </form>
  );
}
