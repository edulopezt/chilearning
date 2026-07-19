"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
import { Card } from "@/components/ui/card";
import { discardDraftAction } from "../actions";

const t = esCL.wizard;

/**
 * Draft `status = "processing"` (fix de seguridad post-5.10): el .docx del
 * descriptor SENCE se analiza en el WORKER, no al subirlo — esta vista se
 * refresca sola (mismo patrón que `SessionCountdown`) hasta que el worker
 * termine y la página recargue mostrando el paso "datos" ya prellenado.
 */
export function DescriptorProcessingStatus() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(id);
  }, [router]);

  return (
    <Card className="items-start gap-3 p-4">
      <h2 className="text-base font-semibold">{t.descriptorProcessingTitle}</h2>
      <p className="text-sm text-muted-foreground">{t.descriptorProcessingBody}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}>
        {t.refreshNow}
      </Button>
    </Card>
  );
}

const DESCRIPTOR_ERROR_LABELS: Record<string, string> = esCL.wizard.descriptorErrors;

/** Draft `status = "failed"`: el worker no pudo procesar el .docx (`descriptor_error` trae el motivo). */
export function DescriptorFailedStatus({ draftId, errorCode }: { draftId: string; errorCode: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [discardError, setDiscardError] = useState(false);
  const message = (errorCode && DESCRIPTOR_ERROR_LABELS[errorCode]) || t.descriptorErrorGeneric;

  function discard(): void {
    start(async () => {
      setDiscardError(false);
      const result = await discardDraftAction(draftId);
      if (!result.ok) {
        setDiscardError(true);
        return;
      }
      router.push("/admin/cursos/asistente");
    });
  }

  return (
    <Card className="items-start gap-3 border-destructive/30 p-4">
      <h2 className="text-base font-semibold">{t.descriptorFailedTitle}</h2>
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
      <p className="text-sm text-muted-foreground">{t.descriptorFailedHint}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/cursos/asistente" className="text-sm underline underline-offset-4">
          {t.backToWizard}
        </Link>
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
      </div>
      {discardError ? (
        <span role="alert" className="text-xs text-destructive">
          {t.discardError}
        </span>
      ) : null}
    </Card>
  );
}
