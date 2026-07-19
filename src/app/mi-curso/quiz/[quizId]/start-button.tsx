"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { startAttemptAction, type StartState } from "./actions";

const t = esCL.quizStudent;

/** Botón que inicia un intento (Server Action + revalidate muestra el runner). */
export function StartAttemptButton({ quizId, label }: { quizId: string; label: string }) {
  const [state, formAction, pending] = useActionState<StartState, FormData>(startAttemptAction, {
    status: "idle",
  });
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="quizId" value={quizId} />
      <Button type="submit" size="lg" loading={pending} className="self-start">
        {label}
      </Button>
      {state.status === "error" ? (
        <Alert variant="destructive" role="alert" className="w-auto py-2">
          <AlertDescription>{t.genericError}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
