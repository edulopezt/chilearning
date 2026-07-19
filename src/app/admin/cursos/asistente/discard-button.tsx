"use client";

import { useState, useTransition } from "react";

import { esCL } from "@/i18n/es-CL";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { discardDraftAction } from "./actions";

const t = esCL.wizard;

/** Descarta un borrador (AlertDialog de confirmación + Server Action, igual que PackageRowActions). */
export function DiscardButton({ draftId }: { draftId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);

  function discard(): void {
    start(async () => {
      setError(false);
      const result = await discardDraftAction(draftId);
      if (!result.ok) setError(true);
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button type="button" variant="ghost" size="sm" loading={pending} className="text-destructive">
              {pending ? t.discarding : t.discard}
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.discard}</AlertDialogTitle>
            <AlertDialogDescription>{t.discardConfirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{esCL.common.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={discard}>
              {t.discard}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {t.discardError}
        </span>
      ) : null}
    </span>
  );
}
