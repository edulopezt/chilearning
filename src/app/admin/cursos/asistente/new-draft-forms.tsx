"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import { WIZARD_TEMPLATES } from "@/modules/academico/domain/course-wizard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldLabel, FieldRoot } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createDraftDescriptorAction, createDraftScratchAction, type CreateDraftState } from "./actions";

const t = esCL.wizard;

/** Las DOS entradas del asistente (HU-4.5): desde cero (con plantilla) o desde un descriptor SENCE. */
export function NewDraftForms() {
  const [scratchState, scratchAction, scratchPending] = useActionState<CreateDraftState, FormData>(
    createDraftScratchAction,
    { status: "idle" },
  );
  const [descriptorState, descriptorAction, descriptorPending] = useActionState<CreateDraftState, FormData>(
    createDraftDescriptorAction,
    { status: "idle" },
  );

  return (
    <section className="grid gap-6 border-t pt-6 sm:grid-cols-2">
      <Card className="gap-3 p-4">
        <form action={scratchAction} className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">{t.fromScratch}</h2>
          <FieldRoot>
            <FieldLabel>{t.templateLabel}</FieldLabel>
            <Select name="templateId" defaultValue="">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t.templateNone}</SelectItem>
                {Object.values(WIZARD_TEMPLATES).map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>
                    {tpl.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRoot>
          <Button type="submit" loading={scratchPending}>
            {t.startFromScratch}
          </Button>
          {scratchState.status === "error" ? (
            <p role="alert" className="text-sm text-destructive">
              {t.genericError}
            </p>
          ) : null}
        </form>
      </Card>

      <Card className="gap-3 p-4">
        <form action={descriptorAction} className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">{t.fromDescriptor}</h2>
          <div className="flex flex-col gap-1.5">
            <Label>{t.descriptorFileLabel}</Label>
            <input
              name="file"
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              required
              className="text-sm file:mr-2 file:inline-flex file:h-9 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:text-sm file:font-medium file:text-secondary-foreground"
            />
            <span className="text-xs text-muted-foreground">{t.descriptorFileHint}</span>
          </div>
          <Button type="submit" loading={descriptorPending}>
            {t.startFromDescriptor}
          </Button>
          {descriptorState.status === "file" ? (
            <p role="alert" className="text-sm text-destructive">
              {t.descriptorFileError}
            </p>
          ) : null}
          {descriptorState.status === "error" ? (
            <p role="alert" className="text-sm text-destructive">
              {t.genericError}
            </p>
          ) : null}
        </form>
      </Card>
    </section>
  );
}
