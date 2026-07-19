"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import type { WizardState } from "@/modules/academico/domain/course-wizard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldControl, FieldDescription, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  saveAprendizajesStepAction,
  saveCompletitudStepAction,
  saveContenidoStepAction,
  saveDatosStepAction,
  saveEstructuraStepAction,
  saveEvaluacionesStepAction,
  type StepFormState,
} from "./actions";

/**
 * Formularios de cada paso del asistente (task 5.10). Sin estado de cliente
 * complejo a propósito: cada paso es un `<form>` simple sobre `useActionState`
 * — el estado real vive en `course_drafts.state` (BD) entre pasos, no en el
 * navegador. Las listas (módulos/lecciones/evaluaciones) usan una mini-sintaxis
 * de una línea por ítem ("campo | campo | …") en vez de filas dinámicas con JS,
 * que el Server Action traduce al shape que espera `parseWizardStep`.
 */

const t = esCL.wizard;
const tc = esCL.courses;

function ValidationList({ state }: { state: StepFormState }) {
  if (state.status !== "error") return null;
  const entries = Object.entries(state.errors);
  if (entries.length === 0) return null;
  return (
    <Alert variant="destructive" role="alert">
      <div className="flex flex-col gap-1">
        <AlertTitle>{t.validationTitle}</AlertTitle>
        <AlertDescription>
          <ul className="list-disc pl-5">
            {entries.map(([field, message]) => (
              <li key={field}>{message}</li>
            ))}
          </ul>
        </AlertDescription>
      </div>
    </Alert>
  );
}

export function DatosStepForm({ draftId, state }: { draftId: string; state: WizardState }) {
  const action = saveDatosStepAction.bind(null, draftId);
  const [formState, formAction, pending] = useActionState<StepFormState, FormData>(action, { status: "idle" });
  const datos = state.datos;
  const hasSeed = state.datosSeed.name !== null || state.datosSeed.hours !== null;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {hasSeed ? <p className="text-sm text-muted-foreground">{t.seedHint}</p> : null}
      <FieldRoot>
        <FieldLabel>{tc.nameLabel}</FieldLabel>
        <FieldControl name="name" required defaultValue={datos?.name ?? state.datosSeed.name ?? ""} />
      </FieldRoot>
      <div className="grid gap-5 sm:grid-cols-2">
        <FieldRoot>
          <FieldLabel>{tc.modalityLabel}</FieldLabel>
          <Select name="modality" defaultValue={datos?.modality ?? "elearning"}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="elearning">{tc.modElearning}</SelectItem>
              <SelectItem value="blended">{tc.modBlended}</SelectItem>
              <SelectItem value="presential">{tc.modPresential}</SelectItem>
            </SelectContent>
          </Select>
        </FieldRoot>
        <FieldRoot>
          <FieldLabel>{tc.hoursLabel}</FieldLabel>
          <FieldControl name="hours" type="number" min={0} defaultValue={datos?.hours ?? state.datosSeed.hours ?? 0} />
        </FieldRoot>
      </div>
      <Label>
        <Checkbox name="sence" value="true" defaultChecked={datos?.sence ?? false} />
        {tc.senceLabel}
      </Label>
      <FieldRoot>
        <FieldLabel>{tc.codSenceLabel}</FieldLabel>
        <FieldControl name="codSence" inputMode="numeric" maxLength={10} defaultValue={datos?.codSence ?? ""} className="font-mono" />
        <FieldDescription>{tc.codSenceHint}</FieldDescription>
      </FieldRoot>
      <FieldRoot className="max-w-32">
        <FieldLabel>{esCL.certExpiry.validityLabel}</FieldLabel>
        <FieldControl
          name="validityMonths"
          type="number"
          min={1}
          max={120}
          placeholder="—"
          defaultValue={datos?.validityMonths ?? ""}
        />
      </FieldRoot>
      <ValidationList state={formState} />
      <Button type="submit" loading={pending} className="self-start">
        {t.saveAndContinue}
      </Button>
    </form>
  );
}

export function EstructuraStepForm({ draftId, state }: { draftId: string; state: WizardState }) {
  const action = saveEstructuraStepAction.bind(null, draftId);
  const [formState, formAction, pending] = useActionState<StepFormState, FormData>(action, { status: "idle" });
  // Los módulos YA EXISTENTES viajan con su id ("id | título | horas") para
  // que reordenar/editar esta lista NO les reasigne un id nuevo por posición
  // (4-ojos MED — ver el comentario de `parseModulesTextarea` en actions.ts).
  const defaultValue = state.estructura.modules.map((m) => `${m.id} | ${m.title} | ${m.hours}`).join("\n");

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <FieldRoot>
        <FieldLabel>{t.estructuraLabel}</FieldLabel>
        <FieldDescription>{t.estructuraHint}</FieldDescription>
        <FieldControl
          name="modules"
          defaultValue={defaultValue}
          placeholder={t.estructuraPlaceholder}
          render={<Textarea rows={8} className="font-mono text-sm" />}
        />
      </FieldRoot>
      <ValidationList state={formState} />
      <Button type="submit" loading={pending} className="self-start">
        {t.saveAndContinue}
      </Button>
    </form>
  );
}

export function AprendizajesStepForm({ draftId, state }: { draftId: string; state: WizardState }) {
  const modules = state.estructura.modules;
  const action = saveAprendizajesStepAction.bind(
    null,
    draftId,
    modules.map((m) => m.id),
  );
  const [formState, formAction, pending] = useActionState<StepFormState, FormData>(action, { status: "idle" });

  if (modules.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.noModulesYet}</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">{t.aprendizajesHint}</p>
      {state.outcomesSeed.length > 0 ? (
        <div className="rounded-lg border p-3 text-sm">
          <p className="font-medium">{t.outcomesSeedTitle}</p>
          <ul className="list-disc pl-5">
            {state.outcomesSeed.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {modules.map((m) => (
        <FieldRoot key={m.id}>
          <FieldLabel>
            {t.aprendizajesLabelFor} «{m.title}»
          </FieldLabel>
          <FieldControl
            name={`outcomes_${m.id}`}
            defaultValue={(state.aprendizajes[m.id] ?? []).join("\n")}
            render={<Textarea rows={4} />}
          />
        </FieldRoot>
      ))}
      <ValidationList state={formState} />
      <Button type="submit" loading={pending} className="self-start">
        {t.saveAndContinue}
      </Button>
    </form>
  );
}

export function ContenidoStepForm({ draftId, state }: { draftId: string; state: WizardState }) {
  const action = saveContenidoStepAction.bind(null, draftId);
  const [formState, formAction, pending] = useActionState<StepFormState, FormData>(action, { status: "idle" });
  const defaultValue = state.contenido.lessons.map((l) => `${l.moduleId} | ${l.title} | ${l.kind} | ${l.content}`).join("\n");

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.estructura.modules.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t.moduleIdsHint} {state.estructura.modules.map((m) => `${m.id} (${m.title})`).join(", ")}
        </p>
      ) : null}
      <FieldRoot>
        <FieldLabel>{t.contenidoLabel}</FieldLabel>
        <FieldDescription>{t.contenidoHint}</FieldDescription>
        <FieldControl
          name="lessons"
          defaultValue={defaultValue}
          placeholder={t.contenidoPlaceholder}
          render={<Textarea rows={8} className="font-mono text-sm" />}
        />
      </FieldRoot>
      <ValidationList state={formState} />
      <Button type="submit" loading={pending} className="self-start">
        {t.saveAndContinue}
      </Button>
    </form>
  );
}

export function EvaluacionesStepForm({ draftId, state }: { draftId: string; state: WizardState }) {
  const action = saveEvaluacionesStepAction.bind(null, draftId);
  const [formState, formAction, pending] = useActionState<StepFormState, FormData>(action, { status: "idle" });
  const defaultQuizzes = state.evaluaciones.quizzes.map((q) => `${q.moduleId} | ${q.title}`).join("\n");

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.estructura.modules.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t.moduleIdsHint} {state.estructura.modules.map((m) => `${m.id} (${m.title})`).join(", ")}
        </p>
      ) : null}
      <FieldRoot>
        <FieldLabel>{t.quizzesLabel}</FieldLabel>
        <FieldDescription>{t.quizzesHint}</FieldDescription>
        <FieldControl
          name="quizzes"
          defaultValue={defaultQuizzes}
          placeholder={t.quizzesPlaceholder}
          render={<Textarea rows={6} className="font-mono text-sm" />}
        />
      </FieldRoot>
      <fieldset className="flex flex-col gap-3 rounded-md border p-4">
        <Label>
          <Checkbox name="surveyEnabled" value="true" defaultChecked={state.evaluaciones.survey.enabled} />
          {t.surveyEnabledLabel}
        </Label>
        <FieldRoot>
          <FieldLabel>{t.surveyTitleLabel}</FieldLabel>
          <FieldControl name="surveyTitle" defaultValue={state.evaluaciones.survey.title} />
        </FieldRoot>
      </fieldset>
      <ValidationList state={formState} />
      <Button type="submit" loading={pending} className="self-start">
        {t.saveAndContinue}
      </Button>
    </form>
  );
}

export function CompletitudStepForm({ draftId, state }: { draftId: string; state: WizardState }) {
  const action = saveCompletitudStepAction.bind(null, draftId);
  const [formState, formAction, pending] = useActionState<StepFormState, FormData>(action, { status: "idle" });
  const rules = state.completitud;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-3 rounded-md border p-4">
        <legend className="px-1 text-sm font-medium">{tc.rulesTitle}</legend>
        <Label>
          <Checkbox name="requireAllLessons" value="true" defaultChecked={rules?.requireAllLessons ?? true} />
          {tc.requireAllLessons}
        </Label>
        <Label>
          <Checkbox name="requireSurvey" value="true" defaultChecked={rules?.requireSurvey ?? false} />
          {tc.requireSurvey}
        </Label>
        <FieldRoot className="max-w-32">
          <FieldLabel>{tc.minAttendance}</FieldLabel>
          <FieldControl name="minAttendancePct" type="number" min={0} max={100} defaultValue={rules?.minAttendancePct ?? 0} />
        </FieldRoot>
      </fieldset>
      <ValidationList state={formState} />
      <Button type="submit" loading={pending} className="self-start">
        {t.saveAndContinue}
      </Button>
    </form>
  );
}
