"use client";

import { useState, useTransition } from "react";

import { esCL } from "@/i18n/es-CL";
import { discardDraftAction } from "./actions";

const t = esCL.wizard;

/** Descarta un borrador (patrón de confirm() + acción, igual que CloneButton/PackageRowActions). */
export function DiscardButton({ draftId }: { draftId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm(t.discardConfirm)) return;
          start(async () => {
            setError(false);
            const result = await discardDraftAction(draftId);
            if (!result.ok) setError(true);
          });
        }}
        className="text-sm text-red-600 underline disabled:opacity-60"
      >
        {pending ? t.discarding : t.discard}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-red-600">
          {t.discardError}
        </span>
      ) : null}
    </span>
  );
}
