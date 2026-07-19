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
import { FieldControl, FieldLabel, FieldRoot } from "@/components/ui/field";
import { revokeCertificateAction } from "./actions";

const t = esCL.certificates;

/** Botón de confirmación: usa el estado del <form> padre para mostrar el spinner. */
function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" loading={pending}>
      {t.revokeConfirm}
    </Button>
  );
}

/** Revocación con motivo obligatorio (confirmación vía AlertDialog). */
export function RevokeForm({ certificateId, actionId }: { certificateId: string; actionId: string }) {
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
        <form action={revokeCertificateAction} className="flex flex-col gap-4">
          <input type="hidden" name="certificateId" value={certificateId} />
          <input type="hidden" name="actionId" value={actionId} />
          <AlertDialogHeader>
            <AlertDialogTitle>{t.revoke}</AlertDialogTitle>
          </AlertDialogHeader>
          <FieldRoot>
            <FieldLabel>{t.revokeReasonLabel}</FieldLabel>
            <FieldControl name="reason" required placeholder={t.revokeReasonLabel} />
          </FieldRoot>
          <AlertDialogFooter>
            <AlertDialogCancel>{esCL.common.cancel}</AlertDialogCancel>
            <ConfirmButton />
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
