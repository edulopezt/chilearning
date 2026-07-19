"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldControl, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { uploadScormAction, type ScormUploadState } from "./actions";

const t = esCL.scorm;

/** Form de subida de un paquete SCORM (task 5.1a). La validación real corre en el worker. */
export function UploadForm({ courseId }: { courseId: string }) {
  const action = uploadScormAction.bind(null, courseId);
  const [state, formAction, pending] = useActionState<ScormUploadState, FormData>(action, { status: "idle" });

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <FieldRoot>
        <FieldLabel>{t.titleLabel}</FieldLabel>
        <FieldControl name="title" required maxLength={200} />
      </FieldRoot>
      <div className="flex flex-col gap-1.5">
        <Label>{t.fileLabel}</Label>
        <input
          name="file"
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          required
          className="text-sm file:mr-2 file:inline-flex file:h-9 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:text-sm file:font-medium file:text-secondary-foreground"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>
          {t.upload}
        </Button>
        {state.status === "ok" ? (
          <Alert variant="success" role="status" className="w-auto py-2">
            <AlertDescription>{t.uploaded}</AlertDescription>
          </Alert>
        ) : null}
        {state.status === "file" ? (
          <Alert variant="destructive" role="alert" className="w-auto py-2">
            <AlertDescription>{t.fileError}</AlertDescription>
          </Alert>
        ) : null}
        {state.status === "error" ? (
          <Alert variant="destructive" role="alert" className="w-auto py-2">
            <AlertDescription>{t.genericError}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </form>
  );
}
