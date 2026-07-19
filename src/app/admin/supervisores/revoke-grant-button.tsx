"use client";

import { useFormStatus } from "react-dom";

import { esCL } from "@/i18n/es-CL";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { revokeGrantAction } from "./actions";

const t = esCL.supervisorGrants;

/** Botón de confirmación: usa el estado del <form> padre para mostrar el spinner. */
function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" loading={pending}>
      {t.revoke}
    </Button>
  );
}

/** Revoca el acceso de un fiscalizador (confirmación vía AlertDialog, task 3.11). */
export function RevokeGrantButton({ grantId }: { grantId: string }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button type="button" variant="ghost" className="text-destructive">
            {t.revoke}
          </Button>
        }
      />
      <AlertDialogContent>
        <form action={revokeGrantAction} className="flex flex-col gap-4">
          <input type="hidden" name="grantId" value={grantId} />
          <AlertDialogHeader>
            <AlertDialogTitle>{t.revoke}</AlertDialogTitle>
            <AlertDialogDescription>{t.revokeConfirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{esCL.common.cancel}</AlertDialogCancel>
            <ConfirmButton />
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
