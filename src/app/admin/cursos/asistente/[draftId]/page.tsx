import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { WIZARD_STEPS, validateForGeneration, type WizardStep } from "@/modules/academico/domain/course-wizard";
import { getDraft } from "@/modules/academico/wizard-service";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { DescriptorFailedStatus, DescriptorProcessingStatus } from "./descriptor-status";
import { RevisionStep } from "./revision-step";
import {
  AprendizajesStepForm,
  CompletitudStepForm,
  ContenidoStepForm,
  DatosStepForm,
  EstructuraStepForm,
  EvaluacionesStepForm,
} from "./step-forms";

export const dynamic = "force-dynamic";

const t = esCL.wizard;

const STEP_LABEL: Record<WizardStep, string> = {
  datos: t.stepDatos,
  estructura: t.stepEstructura,
  aprendizajes: t.stepAprendizajes,
  contenido: t.stepContenido,
  evaluaciones: t.stepEvaluaciones,
  completitud: t.stepCompletitud,
  revision: t.stepRevision,
};

function isWizardStep(v: string | undefined): v is WizardStep {
  return (WIZARD_STEPS as readonly string[]).includes(v ?? "");
}

/** Stepper de los 7 pasos: el actual resaltado; los ya alcanzados son clicables para volver atrás. */
function Stepper({ draftId, currentIdx, activeStep }: { draftId: string; currentIdx: number; activeStep: WizardStep }) {
  return (
    <nav aria-label={t.title} className="flex flex-wrap gap-2 text-sm">
      {WIZARD_STEPS.map((step, i) => {
        const reachable = i <= currentIdx;
        const isActive = step === activeStep;
        const label = `${i + 1}. ${STEP_LABEL[step]}`;
        if (!reachable) {
          return (
            <span key={step} className="rounded-full border px-3 py-1 text-muted-foreground">
              {label}
            </span>
          );
        }
        return (
          <Link
            key={step}
            href={`/admin/cursos/asistente/${draftId}?step=${step}`}
            className={cn(
              "rounded-full border px-3 py-1",
              isActive
                ? "border-primary bg-primary text-primary-foreground"
                : "underline underline-offset-4",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export default async function CourseWizardDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ draftId: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { draftId } = await params;
  const sp = await searchParams;
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator"])) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.forbidden}</p>
      </main>
    );
  }

  const draft = await getDraft(principal, draftId);
  if (!draft || draft.status === "generated" || draft.status === "discarded") {
    redirect("/admin/cursos/asistente");
  }

  // Fix de seguridad post-5.10: el .docx del descriptor SENCE se analiza en
  // el WORKER, no al subirlo — mientras eso corre (o si falló), el draft NO
  // tiene pasos que mostrar todavía.
  if (draft.status === "processing") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 p-4 sm:p-6">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <DescriptorProcessingStatus />
      </main>
    );
  }
  if (draft.status === "failed") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 p-4 sm:p-6">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <DescriptorFailedStatus draftId={draftId} errorCode={draft.descriptorError} />
      </main>
    );
  }

  const currentIdx = WIZARD_STEPS.indexOf(draft.currentStep);
  const requestedStep = isWizardStep(sp.step) ? sp.step : draft.currentStep;
  const requestedIdx = WIZARD_STEPS.indexOf(requestedStep);
  // No se puede saltar adelante del paso ya alcanzado (solo retroceder a editar).
  const activeStep = requestedIdx <= currentIdx ? requestedStep : draft.currentStep;
  const generationCheck = validateForGeneration(draft.state);
  const revisionBlockers = generationCheck.ok ? [] : generationCheck.blockers;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <PageHeader title={t.title} description={STEP_LABEL[activeStep]} />

      <Stepper draftId={draftId} currentIdx={currentIdx} activeStep={activeStep} />

      <section>
        {activeStep === "datos" ? <DatosStepForm draftId={draftId} state={draft.state} /> : null}
        {activeStep === "estructura" ? <EstructuraStepForm draftId={draftId} state={draft.state} /> : null}
        {activeStep === "aprendizajes" ? <AprendizajesStepForm draftId={draftId} state={draft.state} /> : null}
        {activeStep === "contenido" ? <ContenidoStepForm draftId={draftId} state={draft.state} /> : null}
        {activeStep === "evaluaciones" ? <EvaluacionesStepForm draftId={draftId} state={draft.state} /> : null}
        {activeStep === "completitud" ? <CompletitudStepForm draftId={draftId} state={draft.state} /> : null}
        {activeStep === "revision" ? (
          <RevisionStep draftId={draftId} state={draft.state} blockers={revisionBlockers} />
        ) : null}
      </section>

      <Link href="/admin/cursos/asistente" className="text-sm underline underline-offset-4">
        {t.backToWizard}
      </Link>
    </main>
  );
}
