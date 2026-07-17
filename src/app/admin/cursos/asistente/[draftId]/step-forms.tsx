"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import type { WizardState } from "@/modules/academico/domain/course-wizard";
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
const inputCls = "min-h-11 rounded-md border px-3 text-base";
const textareaCls = "rounded-md border p-3 font-mono text-sm";
const btn =
  "min-h-11 rounded-md bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900";

function ValidationList({ state }: { state: StepFormState }) {
  if (state.status !== "error") return null;
  const entries = Object.entries(state.errors);
  if (entries.length === 0) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
    >
      <p className="font-medium">{t.validationTitle}</p>
      <ul className="list-disc pl-5">
        {entries.map(([field, message]) => (
          <li key={field}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

export function DatosStepForm({ draftId, state }: { draftId: string; state: WizardState }) {
  const action = saveDatosStepAction.bind(null, draftId);
  const [formState, formAction, pending] = useActionState<StepFormState, FormData>(action, { status: "idle" });
  const datos = state.datos;
  const hasSeed = state.datosSeed.name !== null || state.datosSeed.hours !== null;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {hasSeed ? <p className="text-muted-foreground text-sm">{t.seedHint}</p> : null}
      <label className="flex flex-col gap-1 text-sm">
        {tc.nameLabel}
        <input name="name" required defaultValue={datos?.name ?? state.datosSeed.name ?? ""} className={inputCls} />
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          {tc.modalityLabel}
          <select name="modality" defaultValue={datos?.modality ?? "elearning"} className={inputCls}>
            <option value="elearning">{tc.modElearning}</option>
            <option value="blended">{tc.modBlended}</option>
            <option value="presential">{tc.modPresential}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {tc.hoursLabel}
          <input
            name="hours"
            type="number"
            min={0}
            defaultValue={datos?.hours ?? state.datosSeed.hours ?? 0}
            className={inputCls}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input name="sence" type="checkbox" value="true" defaultChecked={datos?.sence ?? false} className="size-4" />
        {tc.senceLabel}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {tc.codSenceLabel}
        <input
          name="codSence"
          inputMode="numeric"
          maxLength={10}
          defaultValue={datos?.codSence ?? ""}
          className={`${inputCls} font-mono`}
        />
        <span className="text-muted-foreground text-xs">{tc.codSenceHint}</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {esCL.certExpiry.validityLabel}
        <input
          name="validityMonths"
          type="number"
          min={1}
          max={120}
          placeholder="—"
          defaultValue={datos?.validityMonths ?? ""}
          className={`${inputCls} w-32`}
        />
      </label>
      <ValidationList state={formState} />
      <button type="submit" disabled={pending} className={btn}>
        {t.saveAndContinue}
      </button>
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
      <label className="flex flex-col gap-1 text-sm">
        {t.estructuraLabel}
        <span className="text-muted-foreground text-xs">{t.estructuraHint}</span>
        <textarea
          name="modules"
          rows={8}
          defaultValue={defaultValue}
          placeholder={t.estructuraPlaceholder}
          className={textareaCls}
        />
      </label>
      <ValidationList state={formState} />
      <button type="submit" disabled={pending} className={btn}>
        {t.saveAndContinue}
      </button>
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
    return <p className="text-muted-foreground text-sm">{t.noModulesYet}</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <p className="text-muted-foreground text-sm">{t.aprendizajesHint}</p>
      {state.outcomesSeed.length > 0 ? (
        <div className="rounded-md border p-3 text-sm">
          <p className="font-medium">{t.outcomesSeedTitle}</p>
          <ul className="list-disc pl-5">
            {state.outcomesSeed.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {modules.map((m) => (
        <label key={m.id} className="flex flex-col gap-1 text-sm">
          {t.aprendizajesLabelFor} «{m.title}»
          <textarea
            name={`outcomes_${m.id}`}
            rows={4}
            defaultValue={(state.aprendizajes[m.id] ?? []).join("\n")}
            className="rounded-md border p-3 text-sm"
          />
        </label>
      ))}
      <ValidationList state={formState} />
      <button type="submit" disabled={pending} className={btn}>
        {t.saveAndContinue}
      </button>
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
        <p className="text-muted-foreground text-xs">
          {t.moduleIdsHint} {state.estructura.modules.map((m) => `${m.id} (${m.title})`).join(", ")}
        </p>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        {t.contenidoLabel}
        <span className="text-muted-foreground text-xs">{t.contenidoHint}</span>
        <textarea
          name="lessons"
          rows={8}
          defaultValue={defaultValue}
          placeholder={t.contenidoPlaceholder}
          className={textareaCls}
        />
      </label>
      <ValidationList state={formState} />
      <button type="submit" disabled={pending} className={btn}>
        {t.saveAndContinue}
      </button>
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
        <p className="text-muted-foreground text-xs">
          {t.moduleIdsHint} {state.estructura.modules.map((m) => `${m.id} (${m.title})`).join(", ")}
        </p>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        {t.quizzesLabel}
        <span className="text-muted-foreground text-xs">{t.quizzesHint}</span>
        <textarea
          name="quizzes"
          rows={6}
          defaultValue={defaultQuizzes}
          placeholder={t.quizzesPlaceholder}
          className={textareaCls}
        />
      </label>
      <fieldset className="flex flex-col gap-3 rounded-md border p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            name="surveyEnabled"
            type="checkbox"
            value="true"
            defaultChecked={state.evaluaciones.survey.enabled}
            className="size-4"
          />
          {t.surveyEnabledLabel}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.surveyTitleLabel}
          <input name="surveyTitle" defaultValue={state.evaluaciones.survey.title} className={inputCls} />
        </label>
      </fieldset>
      <ValidationList state={formState} />
      <button type="submit" disabled={pending} className={btn}>
        {t.saveAndContinue}
      </button>
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
        <label className="flex items-center gap-2 text-sm">
          <input
            name="requireAllLessons"
            type="checkbox"
            value="true"
            defaultChecked={rules?.requireAllLessons ?? true}
            className="size-4"
          />
          {tc.requireAllLessons}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            name="requireSurvey"
            type="checkbox"
            value="true"
            defaultChecked={rules?.requireSurvey ?? false}
            className="size-4"
          />
          {tc.requireSurvey}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {tc.minAttendance}
          <input
            name="minAttendancePct"
            type="number"
            min={0}
            max={100}
            defaultValue={rules?.minAttendancePct ?? 0}
            className={`${inputCls} w-32`}
          />
        </label>
      </fieldset>
      <ValidationList state={formState} />
      <button type="submit" disabled={pending} className={btn}>
        {t.saveAndContinue}
      </button>
    </form>
  );
}
