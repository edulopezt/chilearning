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
import { suspendTenantAction } from "./actions";

const t = esCL.superadmin;

/** Botón de confirmación: usa el estado del <form> padre para mostrar el spinner. */
function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" loading={pending}>
      {t.suspend}
    </Button>
  );
}

/**
 * Suspende una OTEC completa (afecta a todos sus usuarios de inmediato) —
 * confirmación vía AlertDialog (task 5.3/H6, HU-1.4).
 */
export function SuspendTenantButton({ tenantId }: { tenantId: string }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button type="button" variant="destructive">{t.suspend}</Button>} />
      <AlertDialogContent>
        <form action={suspendTenantAction} className="flex flex-col gap-4">
          <input type="hidden" name="tenantId" value={tenantId} />
          <AlertDialogHeader>
            <AlertDialogTitle>{t.suspend}</AlertDialogTitle>
            <AlertDialogDescription>{t.suspendConfirm}</AlertDialogDescription>
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
