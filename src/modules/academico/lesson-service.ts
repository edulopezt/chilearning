import "server-only";

import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { parseLessonInput, type LessonFieldError, type LessonInput } from "@/modules/academico/domain/lesson";
import { aiClientFromEnv, type AiClient } from "@/modules/tutor-ia/ai-client";
import { reindexLesson } from "@/modules/tutor-ia/indexing";

/**
 * Constructor de lecciones (task 1.4). CRUD + reordenar vía service-role bajo
 * tenantGuard, autorizado a otec_admin/coordinator. La lección se cuelga de un
 * curso del tenant (aislamiento verificado por el filtro explícito).
 *
 * HOOK del Tutor IA (task 5.8a, HU-11.1): tras un create/update exitoso se
 * reindexa la lección para el RAG SÍNCRONAMENTE (no encolada) — el chunking +
 * FTS son baratos/locales; el único costo de red es el embedding OpenRouter,
 * aceptable para un guardado admin (ver `indexing.ts` para el detalle de esta
 * decisión). Falla en silencio (logueado): un problema del tutor NUNCA debe
 * bloquear el CRUD de lecciones, que es la operación primaria de este archivo.
 */

export interface LessonRow {
  id: string;
  course_id: string;
  title: string;
  kind: string;
  content: string;
  position: number;
  status: string;
}

export type LessonServiceError =
  | "forbidden"
  | "no_tenant"
  | "not_found"
  | "course_not_found"
  | "package_not_found"
  | "package_not_ready";
export type LessonMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: LessonServiceError }
  | { ok: false; validation: LessonFieldError[] };

const MANAGERS = ["otec_admin", "coordinator"] as const;

function canManage(p: Principal): boolean {
  return Boolean(p.tenantId) && authorize(p, p.tenantId!, MANAGERS);
}

export interface LessonServiceDeps {
  /** Inyectable para tests; por defecto usa `OPENROUTER_API_KEY` del env. */
  aiClient?: AiClient;
}

/** Reindexa para el Tutor IA sin arriesgar el resultado del CRUD de la lección. */
async function safeReindex(
  guard: ReturnType<typeof tenantGuard>,
  deps: LessonServiceDeps,
  lesson: { id: string; course_id: string; title: string; kind: string; content: string; status: string },
): Promise<void> {
  try {
    await reindexLesson(
      guard.db,
      { aiClient: deps.aiClient ?? aiClientFromEnv(process.env) },
      { ...lesson, tenant_id: guard.tenantId },
    );
  } catch (err) {
    console.error("[tutor-ia] fallo reindexando una leccion (no bloquea el CRUD)", {
      lessonId: lesson.id,
      message: (err as Error).message,
    });
  }
}

export async function listLessons(principal: Principal, courseId: string): Promise<LessonRow[]> {
  if (!principal.tenantId || !canManage(principal)) return [];
  const guard = tenantGuard(principal.tenantId);
  const { data } = await guard
    .from("lessons")
    .select("id, course_id, title, kind, content, position, status")
    .eq("course_id", courseId)
    .order("position");
  return (data ?? []) as LessonRow[];
}

async function courseInTenant(guard: ReturnType<typeof tenantGuard>, courseId: string): Promise<boolean> {
  const { data } = await guard.from("courses").select("id").eq("id", courseId).maybeSingle();
  return Boolean(data);
}

/**
 * `content` de una lección `kind=scorm` es el UUID de un `scorm_packages.id`.
 * Debe pertenecer al MISMO tenant (garantizado por `tenantGuard`) Y al MISMO
 * curso que la lección; si se publica, el paquete debe estar `ready` (si no,
 * SENCE mostraría un contenido roto al alumno).
 */
async function validateScormPackageRef(
  guard: ReturnType<typeof tenantGuard>,
  courseId: string,
  packageId: string,
  publishing: boolean,
): Promise<LessonServiceError | null> {
  const { data: pkg } = await guard.db
    .from("scorm_packages")
    .select("course_id, status")
    .eq("id", packageId)
    .eq("tenant_id", guard.tenantId)
    .maybeSingle();
  if (!pkg || pkg.course_id !== courseId) return "package_not_found";
  if (publishing && pkg.status !== "ready") return "package_not_ready";
  return null;
}

export async function createLesson(
  principal: Principal,
  courseId: string,
  raw: Record<string, unknown>,
  deps: LessonServiceDeps = {},
): Promise<LessonMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const parsed = parseLessonInput(raw);
  if (!parsed.ok) return { ok: false, validation: parsed.errors };

  const guard = tenantGuard(principal.tenantId);
  if (!(await courseInTenant(guard, courseId))) return { ok: false, error: "course_not_found" };

  if (parsed.value.kind === "scorm") {
    const err = await validateScormPackageRef(guard, courseId, parsed.value.content, parsed.value.status === "published");
    if (err) return { ok: false, error: err };
  }

  // La nueva lección va al final (posición máxima + 1).
  const { data: last } = await guard.db
    .from("lessons")
    .select("position")
    .eq("course_id", courseId)
    .eq("tenant_id", principal.tenantId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last?.position as number) ?? 0) + 1;

  const { data, error } = await guard.db
    .from("lessons")
    .insert(guard.withTenant({ course_id: courseId, position, ...toRow(parsed.value) }))
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "not_found" };

  await safeReindex(guard, deps, {
    id: data.id as string,
    course_id: courseId,
    title: parsed.value.title,
    kind: parsed.value.kind,
    content: parsed.value.content,
    status: parsed.value.status,
  });
  return { ok: true, id: data.id as string };
}

export async function updateLesson(
  principal: Principal,
  lessonId: string,
  raw: Record<string, unknown>,
  deps: LessonServiceDeps = {},
): Promise<LessonMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const parsed = parseLessonInput(raw);
  if (!parsed.ok) return { ok: false, validation: parsed.errors };

  const guard = tenantGuard(principal.tenantId);

  if (parsed.value.kind === "scorm") {
    const { data: existing } = await guard.from("lessons").select("course_id").eq("id", lessonId).maybeSingle();
    if (!existing) return { ok: false, error: "not_found" };
    const err = await validateScormPackageRef(
      guard,
      existing.course_id as string,
      parsed.value.content,
      parsed.value.status === "published",
    );
    if (err) return { ok: false, error: err };
  }

  const { data, error } = await guard.db
    .from("lessons")
    .update(toRow(parsed.value))
    .eq("id", lessonId)
    .eq("tenant_id", principal.tenantId)
    .select("id, course_id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "not_found" };

  await safeReindex(guard, deps, {
    id: data.id as string,
    course_id: data.course_id as string,
    title: parsed.value.title,
    kind: parsed.value.kind,
    content: parsed.value.content,
    status: parsed.value.status,
  });
  return { ok: true, id: data.id as string };
}

export async function deleteLesson(principal: Principal, lessonId: string): Promise<LessonMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const guard = tenantGuard(principal.tenantId);
  // `course_chunks.lesson_id` referencia `lessons` con `on delete restrict`
  // (task 5.8a, Tutor IA): hay que soltar sus chunks ANTES de poder borrar la
  // lección, o el DELETE de abajo revienta con una violación de FK.
  await guard.db.from("course_chunks").delete().eq("lesson_id", lessonId).eq("tenant_id", principal.tenantId);
  const { data, error } = await guard.db
    .from("lessons")
    .delete()
    .eq("id", lessonId)
    .eq("tenant_id", principal.tenantId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "not_found" };
  return { ok: true, id: data.id as string };
}

/** Mueve una lección arriba/abajo intercambiando su posición con la vecina. */
export async function moveLesson(
  principal: Principal,
  lessonId: string,
  direction: "up" | "down",
): Promise<LessonMutationResult> {
  if (!principal.tenantId) return { ok: false, error: "no_tenant" };
  if (!canManage(principal)) return { ok: false, error: "forbidden" };
  const guard = tenantGuard(principal.tenantId);

  const { data: lesson } = await guard.db
    .from("lessons")
    .select("id, course_id, position")
    .eq("id", lessonId)
    .eq("tenant_id", principal.tenantId)
    .maybeSingle();
  if (!lesson) return { ok: false, error: "not_found" };

  const cmp = direction === "up" ? "lt" : "gt";
  const { data: neighbor } = await guard.db
    .from("lessons")
    .select("id, position")
    .eq("course_id", lesson.course_id)
    .eq("tenant_id", principal.tenantId)
    [cmp]("position", lesson.position)
    .order("position", { ascending: direction === "down" })
    .limit(1)
    .maybeSingle();
  if (!neighbor) return { ok: true, id: lessonId }; // ya está en el extremo

  // Intercambio de posiciones (dos updates).
  await guard.db.from("lessons").update({ position: neighbor.position }).eq("id", lesson.id).eq("tenant_id", principal.tenantId);
  await guard.db.from("lessons").update({ position: lesson.position }).eq("id", neighbor.id).eq("tenant_id", principal.tenantId);
  return { ok: true, id: lessonId };
}

function toRow(v: LessonInput): Record<string, unknown> {
  return { title: v.title, kind: v.kind, content: v.content, status: v.status };
}
