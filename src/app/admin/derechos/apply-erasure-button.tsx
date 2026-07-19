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
import { applyErasureAction } from "./actions";

const t = esCL.dsrAdmin;

/** Botón de confirmación: usa el estado del <form> padre para mostrar el spinner. */
function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" loading={pending}>
      {t.applyErasure}
    </Button>
  );
}

/** Aplica la supresión de datos personales (irreversible, Ley 21.719) — confirmación vía AlertDialog. */
export function ApplyErasureButton({ requestId }: { requestId: string }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button type="button" variant="destructive">{t.applyErasure}</Button>} />
      <AlertDialogContent>
        <form action={applyErasureAction} className="flex flex-col gap-4">
          <input type="hidden" name="requestId" value={requestId} />
          <AlertDialogHeader>
            <AlertDialogTitle>{t.applyErasure}</AlertDialogTitle>
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
