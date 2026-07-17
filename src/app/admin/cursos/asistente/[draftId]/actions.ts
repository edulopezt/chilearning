"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { WizardStep } from "@/modules/academico/domain/course-wizard";
import { generateFromDraft, saveStep } from "@/modules/academico/wizard-service";
import { getPrincipal } from "@/modules/core/auth/session";

/** Server Actions de un paso del asistente (task 5.10): un archivo por [draftId] entero. */

export type StepFormState =
  | { readonly status: "idle" }
  | { readonly status: "error"; readonly errors: Record<string, string> }
  | { readonly status: "forbidden" };

async function runSaveStep(draftId: string, step: WizardStep, raw: unknown): Promise<StepFormState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "forbidden" };

  const result = await saveStep(principal, draftId, step, raw);
  revalidatePath(`/admin/cursos/asistente/${draftId}`);
  if (result.ok) {
    // Avanza a la vista del paso siguiente (o del que el guard decidió que toca).
    redirect(`/admin/cursos/asistente/${draftId}?step=${result.currentStep}`);
  }
  if ("validation" in result) return { status: "error", errors: result.validation };
  return { status: "forbidden" };
}

function textareaLines(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** "título | horas" por línea. */
function parseModulesTextarea(raw: FormDataEntryValue | null): { modules: { title: string; hours: string }[] } {
  const modules = textareaLines(raw).map((line) => {
    const [title, hours] = line.split("|").map((s) => s.trim());
    return { title: title ?? "", hours: hours ?? "" };
  });
  return { modules };
}

/** "id del módulo | título | tipo | contenido" por línea (el contenido puede traer "|"). */
function parseLessonsTextarea(
  raw: FormDataEntryValue | null,
): { lessons: { moduleId: string; title: string; kind: string; content: string }[] } {
  const lessons = textareaLines(raw).map((line) => {
    const [moduleId = "", title = "", kind = "", ...rest] = line.split("|").map((s) => s.trim());
    return { moduleId, title, kind, content: rest.join("|").trim() };
  });
  return { lessons };
}

/** "id del módulo | título" por línea. */
function parseQuizzesTextarea(raw: FormDataEntryValue | null): { moduleId: string; title: string }[] {
  return textareaLines(raw).map((line) => {
    const [moduleId, title] = line.split("|").map((s) => s.trim());
    return { moduleId: moduleId ?? "", title: title ?? "" };
  });
}

export async function saveDatosStepAction(
  draftId: string,
  _prev: StepFormState,
  formData: FormData,
): Promise<StepFormState> {
  return runSaveStep(draftId, "datos", {
    name: formData.get("name"),
    modality: formData.get("modality"),
    hours: formData.get("hours"),
    sence: formData.get("sence"),
    codSence: formData.get("codSence"),
    validityMonths: formData.get("validityMonths"),
  });
}

export async function saveEstructuraStepAction(
  draftId: string,
  _prev: StepFormState,
  formData: FormData,
): Promise<StepFormState> {
  return runSaveStep(draftId, "estructura", parseModulesTextarea(formData.get("modules")));
}

export async function saveAprendizajesStepAction(
  draftId: string,
  moduleIds: readonly string[],
  _prev: StepFormState,
  formData: FormData,
): Promise<StepFormState> {
  const raw: Record<string, string> = {};
  for (const id of moduleIds) raw[id] = String(formData.get(`outcomes_${id}`) ?? "");
  return runSaveStep(draftId, "aprendizajes", raw);
}

export async function saveContenidoStepAction(
  draftId: string,
  _prev: StepFormState,
  formData: FormData,
): Promise<StepFormState> {
  return runSaveStep(draftId, "contenido", parseLessonsTextarea(formData.get("lessons")));
}

export async function saveEvaluacionesStepAction(
  draftId: string,
  _prev: StepFormState,
  formData: FormData,
): Promise<StepFormState> {
  return runSaveStep(draftId, "evaluaciones", {
    quizzes: parseQuizzesTextarea(formData.get("quizzes")),
    survey: { enabled: formData.get("surveyEnabled"), title: formData.get("surveyTitle") },
  });
}

export async function saveCompletitudStepAction(
  draftId: string,
  _prev: StepFormState,
  formData: FormData,
): Promise<StepFormState> {
  return runSaveStep(draftId, "completitud", {
    requireAllLessons: formData.get("requireAllLessons"),
    requireSurvey: formData.get("requireSurvey"),
    minAttendancePct: formData.get("minAttendancePct"),
  });
}

export type GenerateState =
  | { readonly status: "idle" }
  | { readonly status: "blocked"; readonly blockers: readonly string[] }
  | { readonly status: "partial"; readonly courseId: string }
  | { readonly status: "error" };

/**
 * Materializa el borrador en un curso real. Redirige al detalle en éxito
 * (nunca en parcial/bloqueado). Firma `(draftId, prevState, formData)` para
 * poder colgarla de un `<form action={...}>` vía `useActionState` — mismo
 * patrón (probado) que el resto de las Server Actions de este wizard, en vez
 * de invocarla imperativa desde un `onClick` (superficie nueva sin probar
 * para el `redirect()` interno).
 */
// Firma `(draftId, prevState, formData)` exigida por useActionState (ver doc arriba);
// el formulario no tiene campos, así que prevState/formData quedan sin usar a propósito.
export async function generateDraftAction(
  draftId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: GenerateState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData,
): Promise<GenerateState> {
  const principal = await getPrincipal();
  if (!principal) return { status: "error" };

  const result = await generateFromDraft(principal, draftId);
  if (result.ok) {
    revalidatePath("/admin/cursos");
    revalidatePath(`/admin/cursos/${result.courseId}/lecciones`);
    redirect(`/admin/cursos/${result.courseId}/lecciones?wizard=ok`);
  }
  if (result.error === "blocked") return { status: "blocked", blockers: result.blockers };
  if (result.error === "partial_generation") return { status: "partial", courseId: result.courseId };
  return { status: "error" };
}
