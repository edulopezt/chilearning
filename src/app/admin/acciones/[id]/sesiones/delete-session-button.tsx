"use client";

import { useState, useTransition } from "react";

import { esCL } from "@/i18n/es-CL";
import { deleteSessionAction } from "./actions";

const t = esCL.liveSessions;

/** Borra una sesión SOLO si no tiene asistencia registrada (task 5.4). */
export function DeleteSessionButton({ actionId, sessionId }: { actionId: string; sessionId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const result = await deleteSessionAction(actionId, sessionId);
            if (!result.ok) {
              setMsg(result.error === "has_attendance" ? t.deleteHasAttendance : t.deleteGenericError);
            }
          })
        }
        className="text-sm text-red-600 underline disabled:opacity-60"
      >
        {t.delete}
      </button>
      {msg ? (
        <span role="alert" className="text-xs text-amber-700 dark:text-amber-400">
          {msg}
        </span>
      ) : null}
    </span>
  );
}
