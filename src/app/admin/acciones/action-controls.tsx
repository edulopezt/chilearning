"use client";

import { useState, useTransition } from "react";

import { esCL } from "@/i18n/es-CL";
import type { ActionMutationResult } from "@/modules/academico/action-service";
import { activateActionAction, reexecuteActionAction } from "./actions";

const t = esCL.actions;

function errorLabel(result: ActionMutationResult): string {
  if (result.ok || !("error" in result)) return t.genericError;
  if (result.error === "missing_dates") return t.errMissingDates;
  if (result.error === "code_unchanged") return t.errCodeUnchanged;
  return t.genericError;
}

/** Activar (borrador) o re-ejecutar (activa) una acción (task 2.8). */
export function ActionControls({
  actionId,
  status,
}: {
  actionId: string;
  status: "draft" | "active";
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      {status === "draft" ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMsg(null);
              const result = await activateActionAction(actionId);
              if (!result.ok) setMsg(errorLabel(result));
            })
          }
          className="text-sm font-medium underline disabled:opacity-60"
        >
          {t.activate}
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMsg(null);
              const result = await reexecuteActionAction(actionId);
              setMsg(result.ok ? t.reexecuted : t.genericError);
            })
          }
          className="text-sm underline disabled:opacity-60"
        >
          {t.reexecute}
        </button>
      )}
      {msg ? (
        <span role="alert" className="text-xs text-amber-700 dark:text-amber-400">
          {msg}
        </span>
      ) : null}
    </span>
  );
}
