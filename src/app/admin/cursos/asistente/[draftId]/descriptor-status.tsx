"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
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
    <div className="flex flex-col items-start gap-3 rounded-md border p-4">
      <h2 className="text-base font-semibold">{t.descriptorProcessingTitle}</h2>
      <p className="text-muted-foreground text-sm">{t.descriptorProcessingBody}</p>
      <button type="button" onClick={() => router.refresh()} className="min-h-11 text-sm underline">
        {t.refreshNow}
      </button>
    </div>
  );
}

const DESCRIPTOR_ERROR_LABELS: Record<string, string> = esCL.wizard.descriptorErrors;

/** Draft `status = "failed"`: el worker no pudo procesar el .docx (`descriptor_error` trae el motivo). */
export function DescriptorFailedStatus({ draftId, errorCode }: { draftId: string; errorCode: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [discardError, setDiscardError] = useState(false);
  const message = (errorCode && DESCRIPTOR_ERROR_LABELS[errorCode]) || t.descriptorErrorGeneric;

  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-red-300 p-4 dark:border-red-800">
      <h2 className="text-base font-semibold">{t.descriptorFailedTitle}</h2>
      <p role="alert" className="text-sm text-red-600">
        {message}
      </p>
      <p className="text-muted-foreground text-sm">{t.descriptorFailedHint}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/cursos/asistente" className="min-h-11 text-sm underline">
          {t.backToWizard}
        </Link>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm(t.discardConfirm)) return;
            start(async () => {
              setDiscardError(false);
              const result = await discardDraftAction(draftId);
              if (!result.ok) {
                setDiscardError(true);
                return;
              }
              router.push("/admin/cursos/asistente");
            });
          }}
          className="min-h-11 text-sm text-red-600 underline disabled:opacity-60"
        >
          {pending ? t.discarding : t.discard}
        </button>
      </div>
      {discardError ? (
        <span role="alert" className="text-xs text-red-600">
          {t.discardError}
        </span>
      ) : null}
    </div>
  );
}
