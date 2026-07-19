"use client";

import { useFormStatus } from "react-dom";

import { esCL } from "@/i18n/es-CL";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { revokeCompanyMemberAction } from "./actions";

const t = esCL.companies;

/** Botón de confirmación: usa el estado del <form> padre para mostrar el spinner. */
function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" loading={pending}>
      {t.revoke}
    </Button>
  );
}

/** Revoca el acceso de una persona de RRHH (confirmación vía AlertDialog, task 5.2). */
export function RevokeMemberForm({ memberId }: { memberId: string }) {
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
        <form action={revokeCompanyMemberAction} className="flex flex-col gap-4">
          <input type="hidden" name="memberId" value={memberId} />
          <AlertDialogHeader>
            <AlertDialogTitle>{t.revoke}</AlertDialogTitle>
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
