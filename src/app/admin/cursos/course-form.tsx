"use client";

import { useActionState, useState } from "react";

import { esCL } from "@/i18n/es-CL";
import type { MutationResult } from "@/modules/academico/course-service";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldControl, FieldDescription, FieldError, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createCourseAction } from "./actions";

const t = esCL.courses;
const tExpiry = esCL.certExpiry;

function fieldErrors(state: MutationResult | null): Record<string, string> {
  if (state && !state.ok && "validation" in state) {
    return Object.fromEntries(state.validation.map((e) => [e.field, e.message]));
  }
  return {};
}

export function CourseForm() {
  const [state, formAction, pending] = useActionState<MutationResult | null, FormData>(
    createCourseAction,
    null,
  );
  const [sence, setSence] = useState(false);
  const errors = fieldErrors(state);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FieldRoot invalid={!!errors.name}>
        <FieldLabel>{t.nameLabel}</FieldLabel>
        <FieldControl name="name" required />
        {errors.name ? <FieldError>{errors.name}</FieldError> : null}
      </FieldRoot>

      <div className="grid gap-5 sm:grid-cols-2">
        <FieldRoot>
          <FieldLabel>{t.modalityLabel}</FieldLabel>
          <Select name="modality" defaultValue="elearning">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="elearning">{t.modElearning}</SelectItem>
              <SelectItem value="blended">{t.modBlended}</SelectItem>
              <SelectItem value="presential">{t.modPresential}</SelectItem>
            </SelectContent>
          </Select>
        </FieldRoot>
        <FieldRoot invalid={!!errors.hours}>
          <FieldLabel>{t.hoursLabel}</FieldLabel>
          <FieldControl name="hours" type="number" min={0} defaultValue={0} />
          {errors.hours ? <FieldError>{errors.hours}</FieldError> : null}
        </FieldRoot>
      </div>

      <Label>
        <Checkbox name="sence" value="true" checked={sence} onCheckedChange={setSence} />
        {t.senceLabel}
      </Label>

      {sence ? (
        <FieldRoot invalid={!!errors.codSence}>
          <FieldLabel>{t.codSenceLabel}</FieldLabel>
          <FieldControl name="codSence" inputMode="numeric" maxLength={10} className="font-mono" />
          <FieldDescription>{t.codSenceHint}</FieldDescription>
          {errors.codSence ? <FieldError>{errors.codSence}</FieldError> : null}
        </FieldRoot>
      ) : null}

      <fieldset className="flex flex-col gap-3 rounded-md border p-4">
        <legend className="px-1 text-sm font-medium">{t.rulesTitle}</legend>
        <Label>
          <Checkbox name="requireAllLessons" value="true" defaultChecked />
          {t.requireAllLessons}
        </Label>
        <Label>
          <Checkbox name="requireSurvey" value="true" />
          {t.requireSurvey}
        </Label>
        <FieldRoot className="max-w-32">
          <FieldLabel>{t.minAttendance}</FieldLabel>
          <FieldControl name="minAttendancePct" type="number" min={0} max={100} defaultValue={0} />
        </FieldRoot>
      </fieldset>

      {/* Vigencia del certificado (task 5.12, HU-7.3): vacío = no vence. */}
      <FieldRoot className="max-w-32" invalid={!!errors.validityMonths}>
        <FieldLabel>{tExpiry.validityLabel}</FieldLabel>
        <FieldControl name="validityMonths" type="number" min={1} max={120} placeholder="—" />
        <FieldDescription>{tExpiry.validityHint}</FieldDescription>
        {errors.validityMonths ? <FieldError>{errors.validityMonths}</FieldError> : null}
      </FieldRoot>

      <FieldRoot className="max-w-xs">
        <FieldLabel>{t.statusLabel}</FieldLabel>
        <Select name="status" defaultValue="draft">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">{t.statusDraft}</SelectItem>
            <SelectItem value="published">{t.statusPublished}</SelectItem>
          </SelectContent>
        </Select>
      </FieldRoot>

      {state?.ok ? (
        <Alert variant="success" role="status" className="w-auto">
          <AlertDescription>{t.saved}</AlertDescription>
        </Alert>
      ) : null}
      {state && !state.ok && "error" in state ? (
        <Alert variant="destructive" role="alert" className="w-auto">
          <AlertDescription>{t.genericError}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" loading={pending} className="w-full sm:w-auto">
        {t.save}
      </Button>
    </form>
  );
}
