"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
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
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        loading={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const result = await reexecuteActionAction(actionId);
            setMsg(result.ok ? t.reexecuted : t.genericError);
          })
        }
      >
        {t.reexecute}
      </Button>
      {msg ? (
        <p role="alert" className="text-sm text-warning">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
