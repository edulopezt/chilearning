import "server-only";

import { randomUUID } from "node:crypto";

import JSZip from "jszip";
import mammoth from "mammoth";

import { writeAudit } from "@/lib/audit";
import { tenantGuard, type TenantGuard } from "@/lib/tenant-guard";
import { createCourse } from "@/modules/academico/course-service";
import {
  EMPTY_WIZARD_STATE,
  WIZARD_STEPS,
  WIZARD_TEMPLATES,
  hydrateWizardState,
  parseWizardStep,
  validateForGeneration,
  type WizardState,
  type WizardStep,
} from "@/modules/academico/domain/course-wizard";
import { exceedsDescriptorUncompressedBudget } from "@/modules/academico/domain/descriptor-zip";
import { extractDescriptor } from "@/modules/academico/domain/descriptor-extract";
import { createLesson } from "@/modules/academico/lesson-service";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { safeFileSlug } from "@/modules/evaluacion/domain/assignment";
import { createQuiz } from "@/modules/evaluacion/quiz-service";
import { createSurvey } from "@/modules/evaluacion/survey-service";

/**
 * Servicio del asistente guiado de creación de cursos (task 5.10, HU-3.5/4.5).
 * El estado del wizard vive en `course_drafts` y se edita paso a paso
 * (`saveStep`); `generateFromDraft` es el ÚNICO punto que materializa el
 * borrador en curso+lecciones+evaluaciones REALES (siempre en estado borrador
 * — CA: "nada se publica sin revisión humana"), reusando los servicios de
 * dominio existentes (createCourse/createLesson/createQuiz/createSurvey).
 */

const MANAGERS = ["otec_admin", "coordinator"] as const;
const DESCRIPTOR_BUCKET = "course_descriptors";
const DESCRIPTOR_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_DESCRIPTOR_BYTES = 10 * 1024 * 1024;
// Segunda barrera (además de `exceedsDescriptorUncompressedBudget`, sobre el
// .zip crudo): acota el TEXTO ya extraído antes de pasarlo a
// `extractDescriptor` — un descriptor real (Anexo 4) son unas pocas páginas.
const MAX_DESCRIPTOR_TEXT_LENGTH = 2_000_000; // ~2 MB de texto plano

/**
 * Campo INTERNO de jszip (no forma parte de su `.d.ts` público): igual patrón
 * y mismo aviso que `contenido/scorm-extract.ts::declaredUncompressedSize` —
 * se duplica aquí (3 líneas) en vez de importarla para no acoplar el módulo
 * `academico` a `contenido` por un detalle privado de implementación.
 */
function declaredUncompressedSize(entry: JSZip.JSZipObject): number {
  const raw = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
  return typeof raw?.uncompressedSize === "number" ? raw.uncompressedSize : 0;
}

/** Limpieza best-effort del .docx subido cuando el resto del flujo aborta; loguea si falla (huérfano detectable). */
async function removeDescriptorBestEffort(guard: TenantGuard, descriptorPath: string): Promise<void> {
  const { error } = await guard.db.storage.from(DESCRIPTOR_BUCKET).remove([descriptorPath]);
  if (error) {
    console.error("[wizard] no se pudo limpiar el .docx del descriptor tras un fallo del flujo", {
      message: error.message,
      descriptorPath,
    });
  }
}

// Placeholder mínimo: el CA pide "encuesta configurada" (no que el asistente
// escriba las preguntas), pero a diferencia de los quizzes (que nacen vacíos y
// suman preguntas después) `surveys` guarda su plantilla completa como jsonb y
// exige ≥1 pregunta para poder guardarse (parseSurveyInput). Este único ítem
// deja la encuesta funcional en borrador; el coordinador la completa/ajusta
// antes de publicarla.
const DEFAULT_SURVEY_QUESTIONS = [
  {
    id: "satisfaccion",
    type: "scale" as const,
    label: "¿Qué tan satisfecho quedaste con el curso?",
    required: true,
  },
];

function canManage(p: Principal): boolean {
  return Boolean(p.tenantId) && authorize(p, p.tenantId!, MANAGERS);
}

export type WizardServiceError =
  | "forbidden"
  | "no_tenant"
  | "not_found"
  | "file_rejected"
  | "upload_failed"
  | "already_generated";

export type CreateDraftInput =
  | { readonly source: "scratch"; readonly templateId?: string }
  | {
      readonly source: "descriptor";
      readonly file: { readonly name: string; readonly type: string; readonly size: number; readonly bytes: ArrayBuffer };
    };

export type DraftMutationResult =
  | { readonly ok: true; readonly draftId: string }
  | { readonly ok: false; readonly error: WizardServiceError };

interface DraftRow {
  id: string;
  source: "scratch" | "descriptor";
  current_step: string;
  status: "in_progress" | "generated" | "discarded";
  updated_at: string;
  generated_course_id: string | null;
}

export interface DraftListItem {
  readonly id: string;
  readonly source: "scratch" | "descriptor";
  readonly currentStep: WizardStep;
  readonly status: "in_progress" | "generated" | "discarded";
  readonly updatedAt: string;
  readonly generatedCourseId: string | null;
}

function toListItem(row: DraftRow): DraftListItem {
  return {
    id: row.id,
    source: row.source,
    currentStep: row.current_step as WizardStep,
    status: row.status,
    updatedAt: row.updated_at,
    generatedCourseId: row.generated_course_id,
  };
}

/** Crea un borrador nuevo: desde cero (con o sin plantilla) o desde un descriptor SENCE (.docx). */
export async function createDraft(principal: Principal, input: CreateDraftInput): Promise<DraftMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  if (input.source === "scratch") {
    const template = input.templateId ? WIZARD_TEMPLATES[input.templateId] : undefined;
    const state: WizardState = template ? { ...EMPTY_WIZARD_STATE, ...template.state } : EMPTY_WIZARD_STATE;

    const { data, error } = await guard.db
      .from("course_drafts")
      .insert(
        guard.withTenant({
          created_by: principal.userId,
          source: "scratch",
          state,
          current_step: "datos",
          status: "in_progress",
        }),
      )
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "not_found" };

    await writeAudit(guard, {
      actorUserId: principal.userId,
      action: "course_draft.created",
      entity: "course_drafts",
      entityId: data.id as string,
      details: { source: "scratch", templateId: input.templateId ?? null },
    });
    return { ok: true, draftId: data.id as string };
  }

  // ---------- source === "descriptor" ----------
  const { file } = input;
  if (file.type !== DESCRIPTOR_MIME || file.size <= 0 || file.size > MAX_DESCRIPTOR_BYTES) {
    return { ok: false, error: "file_rejected" };
  }

  const draftId = randomUUID();
  const descriptorPath = `${tenantId}/${draftId}/${safeFileSlug(file.name)}`;
  const bytes = Buffer.from(file.bytes);

  const { error: uploadError } = await guard.db.storage
    .from(DESCRIPTOR_BUCKET)
    .upload(descriptorPath, bytes, { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, error: "upload_failed" };

  // Guardia anti zip-bomb (4-ojos HIGH/MED, "un .docx es un .zip"): pre-chequeo
  // BARATO (sin descomprimir nada) contra el tamaño DECLARADO en el
  // directorio central del .zip, ANTES de invocar `mammoth` — que corre
  // INLINE en este proceso web compartido por todos los tenants, a
  // diferencia de la ingesta SCORM (que hace este mismo trabajo en el
  // worker aislado). Ver el aviso completo en `domain/descriptor-zip.ts`.
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err) {
    console.error("[wizard] el descriptor no es un .zip/.docx válido", {
      message: err instanceof Error ? err.message : String(err),
    });
    await removeDescriptorBestEffort(guard, descriptorPath);
    return { ok: false, error: "file_rejected" };
  }
  const totalUncompressed = Object.values(zip.files)
    .filter((f) => !f.dir)
    .reduce((sum, entry) => sum + declaredUncompressedSize(entry), 0);
  if (exceedsDescriptorUncompressedBudget(totalUncompressed)) {
    console.error("[wizard] descriptor rechazado: excede el presupuesto de bytes descomprimidos declarados", {
      totalUncompressed,
    });
    await removeDescriptorBestEffort(guard, descriptorPath);
    return { ok: false, error: "file_rejected" };
  }

  let extract: ReturnType<typeof extractDescriptor>;
  try {
    const { value: text } = await mammoth.extractRawText({ buffer: bytes });
    if (text.length > MAX_DESCRIPTOR_TEXT_LENGTH) {
      console.error("[wizard] descriptor rechazado: el texto extraído excede el límite razonable", {
        textLength: text.length,
      });
      await removeDescriptorBestEffort(guard, descriptorPath);
      return { ok: false, error: "file_rejected" };
    }
    extract = extractDescriptor(text);
  } catch (err) {
    console.error("[wizard] no se pudo leer el contenido del descriptor .docx", {
      message: err instanceof Error ? err.message : String(err),
    });
    await removeDescriptorBestEffort(guard, descriptorPath);
    return { ok: false, error: "file_rejected" };
  }

  const state: WizardState = {
    ...EMPTY_WIZARD_STATE,
    estructura: {
      modules: extract.modules.map((m, i) => ({
        id: `m${i + 1}`,
        title: m.title || `Módulo ${i + 1}`,
        hours: m.hours ?? 0,
      })),
    },
    datosSeed: { name: extract.name, hours: extract.totalHours },
    outcomesSeed: extract.outcomes,
    extractWarnings: extract.warnings,
  };

  const { data, error } = await guard.db
    .from("course_drafts")
    .insert(
      guard.withTenant({
        id: draftId,
        created_by: principal.userId,
        source: "descriptor",
        descriptor_path: descriptorPath,
        descriptor_name: file.name.slice(0, 300),
        state,
        current_step: "datos",
        status: "in_progress",
      }),
    )
    .select("id")
    .single();
  if (error || !data) {
    // La fila no se creó: no dejar el .docx huérfano en el bucket.
    await removeDescriptorBestEffort(guard, descriptorPath);
    return { ok: false, error: "upload_failed" };
  }

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "course_draft.created",
    entity: "course_drafts",
    entityId: data.id as string,
    details: { source: "descriptor", descriptorName: file.name },
  });
  return { ok: true, draftId: data.id as string };
}

/** Borradores del tenant (para retomar), más recientes primero. */
export async function listDrafts(principal: Principal): Promise<DraftListItem[]> {
  if (!principal.tenantId || !canManage(principal)) return [];
  const guard = tenantGuard(principal.tenantId);
  const { data } = await guard
    .from("course_drafts")
    .select("id, source, current_step, status, updated_at, generated_course_id")
    .order("updated_at", { ascending: false });
  return ((data ?? []) as DraftRow[]).map(toListItem);
}

export interface DraftDetail extends DraftListItem {
  readonly state: WizardState;
  readonly descriptorName: string | null;
}

export async function getDraft(principal: Principal, draftId: string): Promise<DraftDetail | null> {
  if (!principal.tenantId || !canManage(principal)) return null;
  const guard = tenantGuard(principal.tenantId);
  const { data } = await guard
    .from("course_drafts")
    .select("id, source, current_step, status, updated_at, generated_course_id, state, descriptor_name")
    .eq("id", draftId)
    .maybeSingle();
  if (!data) return null;
  return {
    ...toListItem(data as DraftRow),
    state: hydrateWizardState(data.state),
    descriptorName: (data.descriptor_name as string | null) ?? null,
  };
}

export type SaveStepResult =
  | { readonly ok: true; readonly draftId: string; readonly currentStep: WizardStep }
  | { readonly ok: false; readonly error: WizardServiceError }
  | { readonly ok: false; readonly validation: Record<string, string> };

/**
 * Guarda UN paso del wizard: valida `raw` con `parseWizardStep`, fusiona SOLO
 * la sección de ese paso en el `state` existente (nunca reemplaza el jsonb
 * completo) y avanza `current_step`. Nunca retrocede el progreso ya alcanzado
 * (permite reabrir un paso anterior desde el stepper y volver a guardarlo sin
 * perder los pasos siguientes ya completados).
 */
export async function saveStep(
  principal: Principal,
  draftId: string,
  step: WizardStep,
  raw: unknown,
): Promise<SaveStepResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  if (!WIZARD_STEPS.includes(step)) return { ok: false, error: "not_found" };
  const guard = tenantGuard(principal.tenantId);

  const { data: draft } = await guard
    .from("course_drafts")
    .select("id, state, status, current_step")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft) return { ok: false, error: "not_found" };
  if (draft.status !== "in_progress") return { ok: false, error: "not_found" };

  const currentState = hydrateWizardState(draft.state);
  const result = parseWizardStep(step, raw, currentState);
  if (!result.ok) return { ok: false, validation: result.errors };

  const savedIdx = WIZARD_STEPS.indexOf(step);
  const nextIdx = Math.min(savedIdx + 1, WIZARD_STEPS.length - 1);
  const existingIdx = Math.max(WIZARD_STEPS.indexOf(draft.current_step as WizardStep), 0);
  const newCurrentStep = WIZARD_STEPS[Math.max(nextIdx, existingIdx)] ?? WIZARD_STEPS[WIZARD_STEPS.length - 1]!;

  const { error } = await guard.db
    .from("course_drafts")
    .update({ state: result.state, current_step: newCurrentStep })
    .eq("id", draftId)
    .eq("tenant_id", principal.tenantId);
  if (error) return { ok: false, error: "not_found" };

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "course_draft.step_saved",
    entity: "course_drafts",
    entityId: draftId,
    details: { step },
  });
  return { ok: true, draftId, currentStep: newCurrentStep };
}

/** Descarta un borrador (NUNCA se borra: queda para auditoría). */
export async function discardDraft(
  principal: Principal,
  draftId: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: WizardServiceError }> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const guard = tenantGuard(principal.tenantId);
  const { data, error } = await guard.db
    .from("course_drafts")
    .update({ status: "discarded" })
    .eq("id", draftId)
    .eq("tenant_id", principal.tenantId)
    .eq("status", "in_progress")
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "not_found" };

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "course_draft.discarded",
    entity: "course_drafts",
    entityId: draftId,
  });
  return { ok: true };
}

export type GenerateResult =
  | { readonly ok: true; readonly courseId: string }
  | { readonly ok: false; readonly error: "forbidden" | "no_tenant" | "not_found" | "already_generated" }
  | { readonly ok: false; readonly error: "blocked"; readonly blockers: readonly string[] }
  | { readonly ok: false; readonly error: "partial_generation"; readonly courseId: string };

/**
 * Materializa el borrador en un curso REAL (siempre en estado borrador).
 * Idempotente: si el draft YA tiene `generated_course_id`, se rechaza sin
 * volver a tocar nada (evita duplicar curso/lecciones/evaluaciones en un
 * doble clic o un reintento tras un fallo parcial).
 */
export async function generateFromDraft(principal: Principal, draftId: string): Promise<GenerateResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const guard = tenantGuard(principal.tenantId);

  const { data: draft } = await guard
    .from("course_drafts")
    .select("id, state, status, generated_course_id")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft) return { ok: false, error: "not_found" };
  if (draft.generated_course_id) return { ok: false, error: "already_generated" };
  if (draft.status !== "in_progress") return { ok: false, error: "not_found" };

  const state = hydrateWizardState(draft.state);
  const validation = validateForGeneration(state);
  if (!validation.ok) return { ok: false, error: "blocked", blockers: validation.blockers };

  // `validateForGeneration` garantiza que datos/completitud no son null.
  const datos = state.datos!;
  const completitud = state.completitud!;

  const courseResult = await createCourse(principal, {
    name: datos.name,
    modality: datos.modality,
    hours: datos.hours,
    sence: datos.sence,
    codSence: datos.codSence,
    validityMonths: datos.validityMonths,
    completionRules: completitud,
    status: "draft",
  });
  if (!courseResult.ok) {
    // El "datos" del wizard ya pasó por parseCourseInput al guardarse; un
    // fallo aquí es de infraestructura (RLS/DB), no de validación de campos.
    return { ok: false, error: "not_found" };
  }
  const courseId = courseResult.id;

  // Se enlaza el curso generado ANTES de tocar lecciones/evaluaciones: si algo
  // falla más abajo, el draft deja rastro de qué curso ya existe y una
  // segunda llamada se rechaza por `already_generated` en vez de duplicar.
  //
  // El UPDATE es CONDICIONAL (`generated_course_id IS NULL`) y se verifica la
  // fila devuelta, no solo `error`: el chequeo inicial de arriba (línea ~356)
  // lee `generated_course_id` y el UPDATE lo escribe en dos round-trips
  // SEPARADOS — sin esto, dos llamadas concurrentes (doble clic en dos
  // pestañas) o un solo reintento tras un `linkError` transitorio verían
  // ambas `generated_course_id = null` en su lectura inicial y cada una
  // crearía su PROPIO curso real, duplicando contenido (4-ojos HIGH,
  // orquestacion-idempotencia). Si el UPDATE no logra reservar la fila (0
  // filas afectadas, con o sin `error`), el curso recién creado queda
  // HUÉRFANO (nadie lo referencia): se elimina en el acto para que un
  // reintento posterior NUNCA vea un curso fantasma sumado a uno nuevo, sino
  // como mucho UN curso real por draft.
  const { data: linkedRow, error: linkError } = await guard.db
    .from("course_drafts")
    .update({ generated_course_id: courseId })
    .eq("id", draftId)
    .eq("tenant_id", principal.tenantId)
    .is("generated_course_id", null)
    .select("id")
    .maybeSingle();

  if (linkError || !linkedRow) {
    // Ambiguo si el UPDATE de arriba realmente no aplicó (perdió la carrera /
    // draft ya generado) o si SÍ aplicó pero la respuesta se perdió (blip de
    // red): se relee el estado real del draft antes de decidir qué hacer con
    // el curso huérfano.
    const { data: current } = await guard.db
      .from("course_drafts")
      .select("generated_course_id")
      .eq("id", draftId)
      .maybeSingle();

    if (current?.generated_course_id === courseId) {
      // El UPDATE sí se aplicó pese al error/fila vacía reportados: no hay
      // curso huérfano que limpiar, se sigue de largo con el bucle normal.
    } else {
      console.error("[wizard] no se pudo enlazar el draft con el curso generado: se elimina el curso huérfano", {
        message: linkError?.message ?? "0 filas afectadas (ya enlazado o draft inexistente)",
        draftId,
        courseId,
      });
      const { error: rollbackError } = await guard.db.from("courses").delete().eq("id", courseId).eq("tenant_id", principal.tenantId);
      if (rollbackError) {
        console.error("[wizard] no se pudo eliminar el curso huérfano tras el fallo de enlace", {
          message: rollbackError.message,
          draftId,
          courseId,
        });
      }
      if (current?.generated_course_id) return { ok: false, error: "already_generated" };
      return { ok: false, error: "not_found" };
    }
  }

  try {
    for (let i = 0; i < state.estructura.modules.length; i += 1) {
      const mod = state.estructura.modules[i]!;
      const outcomes = state.aprendizajes[mod.id] ?? [];
      const headerContent =
        outcomes.length > 0
          ? outcomes.map((o) => `- ${o}`).join("\n")
          : "(Sin aprendizajes esperados registrados para este módulo.)";

      const headerResult = await createLesson(principal, courseId, {
        title: `Módulo ${i + 1} — ${mod.title}`,
        kind: "text",
        content: headerContent,
        status: "draft",
      });
      if (!headerResult.ok) {
        throw new Error(`lección-cabecera del módulo "${mod.title}" no se pudo crear`);
      }

      for (const lesson of state.contenido.lessons.filter((l) => l.moduleId === mod.id)) {
        const r = await createLesson(principal, courseId, {
          title: lesson.title,
          kind: lesson.kind,
          content: lesson.content,
          status: "draft",
        });
        if (!r.ok) throw new Error(`lección "${lesson.title}" del módulo "${mod.title}" no se pudo crear`);
      }

      for (const quiz of state.evaluaciones.quizzes.filter((q) => q.moduleId === mod.id)) {
        // Sin `status`: `QuizInput`/`quizToRow` no tienen ese campo — el quiz
        // nace en borrador por el DEFAULT de columna (`quizzes.status`), no
        // por esta llamada (4-ojos LOW: el parámetro era un no-op silencioso).
        const r = await createQuiz(principal, courseId, { title: quiz.title });
        if (!r.ok) throw new Error(`evaluación "${quiz.title}" del módulo "${mod.title}" no se pudo crear`);
      }
    }

    if (state.evaluaciones.survey.enabled) {
      const r = await createSurvey(principal, courseId, {
        title: state.evaluaciones.survey.title,
        intro: "",
        anonymous: true,
        questions: DEFAULT_SURVEY_QUESTIONS,
      });
      if (!r.ok) throw new Error("la encuesta del curso no se pudo crear");
    }
  } catch (err) {
    // Fallo a medio camino: el draft YA quedó con `generated_course_id` fijado
    // arriba, así que jamás se reintenta este bucle completo — la UI manda al
    // constructor libre a terminar a mano lo que falte.
    console.error("[wizard] generación parcial: el bucle de contenido falló a medio camino", {
      message: err instanceof Error ? err.message : String(err),
      draftId,
      courseId,
    });
    return { ok: false, error: "partial_generation", courseId };
  }

  const { error: finalizeError } = await guard.db
    .from("course_drafts")
    .update({ status: "generated" })
    .eq("id", draftId)
    .eq("tenant_id", principal.tenantId);
  if (finalizeError) {
    console.error("[wizard] no se pudo marcar el draft como generado", {
      message: finalizeError.message,
      draftId,
      courseId,
    });
    return { ok: false, error: "partial_generation", courseId };
  }

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "course.assisted_created",
    entity: "courses",
    entityId: courseId,
    details: { draftId },
  });
  return { ok: true, courseId };
}

/** Signed URL (1h) del descriptor archivado, para volver a consultarlo. */
export async function descriptorDownloadUrl(
  principal: Principal,
  draftId: string,
): Promise<{ readonly ok: true; readonly url: string } | { readonly ok: false; readonly error: WizardServiceError }> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const guard = tenantGuard(principal.tenantId);
  const { data: draft } = await guard
    .from("course_drafts")
    .select("descriptor_path")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft || !draft.descriptor_path) return { ok: false, error: "not_found" };

  const { data, error } = await guard.db.storage
    .from(DESCRIPTOR_BUCKET)
    .createSignedUrl(draft.descriptor_path as string, 3600);
  if (error || !data) return { ok: false, error: "not_found" };
  return { ok: true, url: data.signedUrl };
}
