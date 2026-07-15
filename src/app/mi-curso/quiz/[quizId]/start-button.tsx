"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
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
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 self-start rounded-md bg-neutral-900 px-5 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
      >
        {label}
      </button>
      {state.status === "error" ? (
        <span role="alert" className="text-sm text-red-600">
          {t.genericError}
        </span>
      ) : null}
    </form>
  );
}
