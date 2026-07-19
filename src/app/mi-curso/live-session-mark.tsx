"use client";

import { useState, useTransition } from "react";

import { esCL } from "@/i18n/es-CL";
import { Button } from "@/components/ui/button";
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
    return <span className="text-xs text-muted-foreground">{t.markAttendanceOutsideWindow}</span>;
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        loading={pending}
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
      >
        {t.markAttendance}
      </Button>
      {msg ? (
        <span role="status" className="text-xs text-muted-foreground">
          {msg}
        </span>
      ) : null}
    </span>
  );
}
