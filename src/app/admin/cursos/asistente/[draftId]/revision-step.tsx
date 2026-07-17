"use client";

import { useActionState } from "react";
import Link from "next/link";

import { esCL } from "@/i18n/es-CL";
import type { WizardState } from "@/modules/academico/domain/course-wizard";
import { generateDraftAction, type GenerateState } from "./actions";

const t = esCL.wizard;
const btn =
  "min-h-11 rounded-md bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900";

/**
 * Paso "revisión final" (HU-3.5/4.5): resumen legible de TODO el estado +
 * bloqueos de `validateForGeneration` (calculados en el servidor, en
 * `page.tsx`) + botón "Generar" deshabilitado mientras haya bloqueos. El
 * texto de "nada se publica sin revisión" es FIJO y siempre visible.
 */
export function RevisionStep({
  draftId,
  state,
  blockers,
}: {
  draftId: string;
  state: WizardState;
  blockers: readonly string[];
}) {
  const action = generateDraftAction.bind(null, draftId);
  const [genState, formAction, pending] = useActionState<GenerateState, FormData>(action, { status: "idle" });

  return (
    <div className="flex flex-col gap-6">
      <p
        role="note"
        className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
      >
        {t.revisionNotice}
      </p>

      <dl className="flex flex-col gap-4 text-sm">
        <div>
          <dt className="font-semibold">{t.revisionSummaryDatos}</dt>
          <dd>
            {state.datos ? (
              <>
                {state.datos.name} · {state.datos.hours} h · {state.datos.modality}
                {state.datos.sence ? ` · SENCE ${state.datos.codSence ?? ""}` : ""}
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t.revisionSummaryEstructura}</dt>
          <dd>
            {state.estructura.modules.length === 0 ? (
              "—"
            ) : (
              <ul className="list-disc pl-5">
                {state.estructura.modules.map((m) => (
                  <li key={m.id}>
                    {m.title} — {m.hours} h
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t.revisionSummaryEvaluaciones}</dt>
          <dd>
            {state.evaluaciones.quizzes.length} {t.evaluationsCountLabel} · {t.surveyLabel}{" "}
            {state.evaluaciones.survey.enabled ? `«${state.evaluaciones.survey.title}»` : t.surveyDisabled}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t.revisionSummaryCompletitud}</dt>
          <dd>
            {state.completitud
              ? `${t.minAttendanceLabel} ${state.completitud.minAttendancePct}% · ${
                  state.completitud.requireAllLessons ? t.allLessonsLabel : t.partialLessonsLabel
                }${state.completitud.requireSurvey ? ` · ${t.surveyRequiredLabel}` : ""}`
              : "—"}
          </dd>
        </div>
      </dl>

      {blockers.length > 0 ? (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          <p className="font-medium">{t.revisionBlockersTitle}</p>
          <ul className="list-disc pl-5">
            {blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-green-700 dark:text-green-400">{t.revisionReadyNotice}</p>
      )}

      <form action={formAction}>
        <button type="submit" disabled={blockers.length > 0 || pending} className={btn}>
          {pending ? t.generating : t.generate}
        </button>
      </form>

      {genState.status === "partial" ? (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        >
          <p className="font-medium">{t.partialGenerationTitle}</p>
          <p>{t.partialGenerationBody}</p>
          <Link href={`/admin/cursos/${genState.courseId}/lecciones`} className="underline">
            {t.goToBuilder}
          </Link>
        </div>
      ) : null}
      {genState.status === "error" ? (
        <p role="alert" className="text-sm text-red-600">
          {t.generateError}
        </p>
      ) : null}
    </div>
  );
}
