"use client";

import { useState, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { esCL } from "@/i18n/es-CL";
import { deleteSessionAction } from "./actions";

const t = esCL.liveSessions;

/** Borra una sesión SOLO si no tiene asistencia registrada (task 5.4). */
export function DeleteSessionButton({ actionId, sessionId }: { actionId: string; sessionId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function handleDelete() {
    setMsg(null);
    start(async () => {
      const result = await deleteSessionAction(actionId, sessionId);
      if (!result.ok) {
        setMsg(result.error === "has_attendance" ? t.deleteHasAttendance : t.deleteGenericError);
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button type="button" variant="ghost" size="sm" disabled={pending} className="text-destructive">
              {t.delete}
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.delete}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancelEdit}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              {t.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {msg ? (
        <span role="alert" className="text-sm text-warning">
          {msg}
        </span>
      ) : null}
    </span>
  );
}
