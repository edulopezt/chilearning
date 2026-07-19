"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldControl, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DOC_TYPE_LABEL, DOC_TYPES } from "@/modules/reportes/domain/expediente";
import { uploadDocumentAction, type ExpedienteState } from "./actions";

const t = esCL.expediente;

/** Subida de un documento al expediente (task 3.12). */
export function UploadForm({ actionId }: { actionId: string }) {
  const [state, formAction, pending] = useActionState<ExpedienteState, FormData>(uploadDocumentAction, { status: "idle" });
  return (
    <form action={formAction} className="flex flex-col gap-2 border-t pt-4">
      <input type="hidden" name="actionId" value={actionId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <FieldRoot>
          <FieldLabel>{t.typeLabel}</FieldLabel>
          <Select name="docType" defaultValue={DOC_TYPES[0]}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOC_TYPES.map((d) => (
                <SelectItem key={d} value={d}>{DOC_TYPE_LABEL[d]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRoot>
        <FieldRoot>
          <FieldLabel>{t.dateLabel}</FieldLabel>
          <FieldControl name="documentDate" type="date" />
        </FieldRoot>
      </div>
      <FieldRoot>
        <FieldLabel>{t.titleLabel}</FieldLabel>
        <FieldControl name="title" required />
      </FieldRoot>
      <FieldRoot>
        <FieldLabel>{t.fileLabel}</FieldLabel>
        <FieldControl
          render={
            <input
              name="file"
              type="file"
              required
              className="text-sm file:mr-2 file:inline-flex file:h-9 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:text-sm file:font-medium file:text-secondary-foreground"
            />
          }
        />
      </FieldRoot>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          {t.save}
        </Button>
        {state.status === "ok" ? (
          <Alert variant="success" role="status" className="w-auto py-2">
            <AlertDescription>{t.saved}</AlertDescription>
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
