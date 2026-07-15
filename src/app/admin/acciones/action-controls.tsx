"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { esCL } from "@/i18n/es-CL";
import { reexecuteActionAction } from "./actions";

const t = esCL.actions;

/**
 * Controles por acción (task 2.8): un borrador enlaza a la página de activación
 * (donde se ponen código nuevo + fechas); una activa puede re-ejecutarse.
 */
export function ActionControls({
  actionId,
  status,
}: {
  actionId: string;
  status: "draft" | "active";
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  if (status === "draft") {
    return (
      <Link href={`/admin/acciones/${actionId}/activar`} className="text-sm font-medium underline">
        {t.activate}
      </Link>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
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
      {msg ? (
        <span role="alert" className="text-xs text-amber-700 dark:text-amber-400">
          {msg}
        </span>
      ) : null}
    </span>
  );
}
