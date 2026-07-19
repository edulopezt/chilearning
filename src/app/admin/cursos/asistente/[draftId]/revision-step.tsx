"use client";

import { useActionState } from "react";
import Link from "next/link";

import { esCL } from "@/i18n/es-CL";
import type { WizardState } from "@/modules/academico/domain/course-wizard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { generateDraftAction, type GenerateState } from "./actions";

const t = esCL.wizard;

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
      <Alert variant="warning">
        <AlertDescription className="font-medium">{t.revisionNotice}</AlertDescription>
      </Alert>

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
        <Alert variant="destructive" role="alert">
          <div className="flex flex-col gap-1">
            <AlertTitle>{t.revisionBlockersTitle}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5">
                {blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </AlertDescription>
          </div>
        </Alert>
      ) : (
        <Alert variant="success" role="status">
          <AlertDescription>{t.revisionReadyNotice}</AlertDescription>
        </Alert>
      )}

      <form action={formAction}>
        <Button type="submit" disabled={blockers.length > 0} loading={pending}>
          {pending ? t.generating : t.generate}
        </Button>
      </form>

      {genState.status === "partial" ? (
        <Alert variant="warning" role="alert">
          <div className="flex flex-col gap-1">
            <AlertTitle>{t.partialGenerationTitle}</AlertTitle>
            <AlertDescription className="flex flex-col gap-1">
              <p>{t.partialGenerationBody}</p>
              <Link href={`/admin/cursos/${genState.courseId}/lecciones`} className="underline underline-offset-4">
                {t.goToBuilder}
              </Link>
            </AlertDescription>
          </div>
        </Alert>
      ) : null}
      {genState.status === "error" ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t.generateError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
