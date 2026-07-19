"use client";

import { useState, useTransition } from "react";

import { esCL } from "@/i18n/es-CL";
import { Button } from "@/components/ui/button";
import { descriptorDownloadUrlAction } from "./actions";

const t = esCL.wizard;

/**
 * Abre el .docx del descriptor SENCE archivado (signed URL de 1h) en una
 * pestaña nueva. Mismo patrón `useTransition` que `DiscardButton` (task
 * 5.10, 4-ojos MED: hace alcanzable `descriptorDownloadUrl`, que hasta ahora
 * ningún botón/enlace invocaba).
 */
export function DescriptorDownloadButton({ draftId }: { draftId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        loading={pending}
        onClick={() => {
          setError(false);
          start(async () => {
            const result = await descriptorDownloadUrlAction(draftId);
            if (!result.ok) {
              setError(true);
              return;
            }
            window.open(result.url, "_blank", "noopener,noreferrer");
          });
        }}
      >
        {pending ? t.downloadingDescriptor : t.downloadDescriptor}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {t.downloadDescriptorError}
        </span>
      ) : null}
    </span>
  );
}
