"use client";

import { useState, useTransition } from "react";

import { esCL } from "@/i18n/es-CL";
import { selfMarkAttendanceAction } from "./actions";

const t = esCL.liveSessions;

/**
 * Botón de auto-marca de asistencia interna (task 5.4). Activo solo cuando el
 * servidor decide que está dentro de la ventana (`canMark`, calculada con
 * `canSelfMark` en el Server Component padre con `serverNowMs`).
 */
export function LiveSessionMark({ sessionId, canMark }: { sessionId: string; canMark: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  if (!canMark) {
    return <span className="text-muted-foreground text-xs">{t.markAttendanceOutsideWindow}</span>;
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const result = await selfMarkAttendanceAction(sessionId);
            if (result.ok) {
              setMsg(result.kept === "manual" ? t.markAttendanceKeptManual : t.markAttendanceDone);
            } else if (result.error === "outside_window") {
              setMsg(t.markAttendanceOutsideWindow);
            } else if (result.error === "forbidden") {
              setMsg(t.markAttendanceForbidden);
            } else {
              setMsg(t.markAttendanceGenericError);
            }
          })
        }
        className="min-h-11 rounded-md border px-4 text-sm font-medium disabled:opacity-60"
      >
        {t.markAttendance}
      </button>
      {msg ? (
        <span role="status" className="text-muted-foreground text-xs">
          {msg}
        </span>
      ) : null}
    </span>
  );
}
