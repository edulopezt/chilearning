import "server-only";

import { tenantGuard } from "@/lib/tenant-guard";
import { computeLock, type SenceSessionStatus } from "@/modules/academico/domain/attendance-lock";
// Reuso INTENCIONAL de un servicio de OTRO módulo (academico): la nota/avance
// SCORM se refleja en el MISMO `lesson_progress` que usa el resto del curso
// (barra de progreso, botón "marcar completada"), así que "completar" una
// lección scorm debe pasar por la ÚNICA función que sabe resolver la
// inscripción del alumno y escribir esa fila — reimplementarla aquí
// duplicaría la lógica de negocio (y el day-2 de mantenerla sincronizada).
import { setLessonProgress } from "@/modules/academico/progress-service";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { extractCmiSignals, MAX_CMI_BYTES, type ScormVersion } from "@/modules/contenido/domain/cmi";

/**
 * Resolución de acceso + persistencia CMI del reproductor SCORM (task 5.1b,
 * HU-4.2, ADR-006). Factoriza la lógica COMPARTIDA por las dos rutas API
 * (proxy de assets y endpoint CMI) para no duplicar el join
 * paquete↔lección↔inscripción en cada route handler.
 *
 * Anti-enumeración (mismo espíritu que el resto de la app): las rutas que
 * consumen `resolveStudentScormAccess`/`resolveStaffPackageAccess` SIEMPRE
 * colapsan `ok:false` a 404 — nunca 403 — para no revelar si un paquete/
 * lección existe a quien no tiene derecho a verlo.
 */

// Mismo set de roles que la policy `scorm_packages_select` (RLS) — el proxy
// bajo service-role no debe otorgar a un rol de gestión más de lo que ya
// vería con su propia sesión (RLS) para esta tabla.
const STAFF_PACKAGE_ROLES = ["otec_admin", "coordinator", "instructor"] as const;
// Mismo set que la policy `scorm_cmi_select` (staff) — resultados del panel.
const RESULT_VIEWER_ROLES = ["otec_admin", "coordinator", "instructor", "tutor"] as const;

export interface StaffPackageAccess {
  readonly tenantId: string;
  readonly packageId: string;
  readonly extractedPrefix: string;
}
export type StaffPackageAccessResult = { ok: true; access: StaffPackageAccess } | { ok: false };

/** ¿Puede este STAFF (rol de gestión) servir cualquier asset de este paquete? */
export async function resolveStaffPackageAccess(
  principal: Principal,
  packageId: string,
): Promise<StaffPackageAccessResult> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, STAFF_PACKAGE_ROLES)) {
    return { ok: false };
  }
  const guard = tenantGuard(principal.tenantId);
  const { data: pkg } = await guard
    .from("scorm_packages")
    .select("id, status, extracted_prefix")
    .eq("id", packageId)
    .eq("status", "ready")
    .maybeSingle();
  if (!pkg || typeof pkg.extracted_prefix !== "string" || !pkg.extracted_prefix) return { ok: false };
  return {
    ok: true,
    access: { tenantId: principal.tenantId, packageId: pkg.id as string, extractedPrefix: pkg.extracted_prefix },
  };
}

export interface StudentScormAccess {
  readonly tenantId: string;
  readonly enrollmentId: string;
  readonly lessonId: string;
  readonly packageId: string;
  readonly scormVersion: ScormVersion;
  readonly extractedPrefix: string;
  readonly entryHref: string;
}
export type StudentScormAccessResult = { ok: true; access: StudentScormAccess } | { ok: false };

/** Punto de entrada del lookup: por paquete (proxy de assets) o por lección (endpoint CMI). */
export type ScormAccessLookup = { readonly by: "package"; readonly packageId: string } | { readonly by: "lesson"; readonly lessonId: string };

interface PackageRow {
  id: string;
  course_id: string;
  status: string;
  scorm_version: string | null;
  extracted_prefix: string | null;
  entry_href: string | null;
}
interface LessonRow {
  id: string;
  course_id: string;
  content: string;
}

function isScormVersion(v: string | null): v is ScormVersion {
  return v === "1.2" || v === "2004";
}

/**
 * ¿Tiene el alumno actual una inscripción vigente y desbloqueada (candado
 * SENCE) para el curso de esta lección scorm? Solo se evalúa para el lookup
 * por LECCIÓN (endpoint CMI): el proxy de assets (lookup por paquete) sirve
 * bytes ya autorizados y NO depende del candado de contenido (misma regla que
 * el resto de assets estáticos de una lección publicada; ver comentario en la
 * ruta del proxy).
 */
async function resolveUnlockedEnrollment(
  guard: ReturnType<typeof tenantGuard>,
  tenantId: string,
  userId: string,
  courseId: string,
  nowMs: number,
): Promise<{ id: string } | null> {
  const { data: enrollment } = await guard.db
    .from("enrollments")
    .select("id, exento, action_id, actions!inner(course_id, attendance_lock)")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("actions.course_id", courseId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!enrollment) return null;

  const action = (enrollment as unknown as { actions: { attendance_lock: boolean } }).actions;
  const { data: session } = await guard.db
    .from("sence_sessions")
    .select("status, expires_at")
    .eq("enrollment_id", enrollment.id as string)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lock = computeLock({
    exento: Boolean(enrollment.exento),
    attendanceLock: Boolean(action.attendance_lock),
    sessionStatus: (session?.status as SenceSessionStatus | undefined) ?? null,
    expiresAtMs: session?.expires_at ? Date.parse(session.expires_at as string) : null,
    nowMs,
  });
  if (!lock.unlocked) return null;

  return { id: enrollment.id as string };
}

/**
 * Resuelve el acceso de un ALUMNO al reproductor/CMI de un paquete SCORM.
 * `nowMs` es inyectable (tests deterministas); por defecto `Date.now()`.
 */
export async function resolveStudentScormAccess(
  principal: Principal,
  lookup: ScormAccessLookup,
  nowMs: number = Date.now(),
): Promise<StudentScormAccessResult> {
  if (!principal.tenantId) return { ok: false };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  let lesson: LessonRow | null = null;
  let pkg: PackageRow | null = null;

  if (lookup.by === "package") {
    const { data: p } = await guard
      .from("scorm_packages")
      .select("id, course_id, status, scorm_version, extracted_prefix, entry_href")
      .eq("id", lookup.packageId)
      .eq("status", "ready")
      .maybeSingle();
    if (!p) return { ok: false };
    pkg = p as PackageRow;

    const { data: l } = await guard
      .from("lessons")
      .select("id, course_id, content")
      .eq("kind", "scorm")
      .eq("status", "published")
      .eq("content", pkg.id)
      .eq("course_id", pkg.course_id)
      .maybeSingle();
    if (!l) return { ok: false };
    lesson = l as LessonRow;
  } else {
    const { data: l } = await guard
      .from("lessons")
      .select("id, course_id, content")
      .eq("id", lookup.lessonId)
      .eq("kind", "scorm")
      .eq("status", "published")
      .maybeSingle();
    if (!l) return { ok: false };
    lesson = l as LessonRow;

    const { data: p } = await guard
      .from("scorm_packages")
      .select("id, course_id, status, scorm_version, extracted_prefix, entry_href")
      .eq("id", lesson.content)
      .eq("status", "ready")
      .maybeSingle();
    if (!p) return { ok: false };
    pkg = p as PackageRow;
  }

  // Defensa en profundidad: `lesson.content` (paquete) debe pertenecer al
  // MISMO curso que la lección (ya lo exige `createLesson` al escribir, pero
  // no cuesta re-afirmarlo aquí ante cualquier futuro cambio de esa regla).
  if (pkg.course_id !== lesson.course_id) return { ok: false };
  if (!isScormVersion(pkg.scorm_version) || !pkg.extracted_prefix || !pkg.entry_href) return { ok: false };

  // El candado de asistencia SOLO aplica al lookup por lección (endpoint CMI):
  // el reproductor ya lo evaluó para decidir si mostrar la página (mismo
  // check que `mi-curso/page.tsx`), y esta es la defensa de servidor
  // equivalente para quien llame al endpoint directo sin pasar por la página.
  const enrollment =
    lookup.by === "lesson"
      ? await resolveUnlockedEnrollment(guard, tenantId, principal.userId, lesson.course_id, nowMs)
      : await (async () => {
          const { data } = await guard.db
            .from("enrollments")
            .select("id, actions!inner(course_id)")
            .eq("tenant_id", tenantId)
            .eq("user_id", principal.userId)
            .eq("actions.course_id", lesson!.course_id)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          return data ? { id: data.id as string } : null;
        })();
  if (!enrollment) return { ok: false };

  return {
    ok: true,
    access: {
      tenantId,
      enrollmentId: enrollment.id,
      lessonId: lesson.id,
      packageId: pkg.id,
      scormVersion: pkg.scorm_version,
      extractedPrefix: pkg.extracted_prefix,
      entryHref: pkg.entry_href,
    },
  };
}

export type StudentScormLessonView =
  | { readonly kind: "ok"; readonly access: StudentScormAccess }
  | { readonly kind: "locked" }
  | { readonly kind: "not_ready" }
  | { readonly kind: "not_found" };

/**
 * Variante de `resolveStudentScormAccess` PARA LA PÁGINA del reproductor
 * (Server Component): a diferencia del endpoint API, que colapsa cualquier
 * fallo a un 404 anti-enumeración indistinguible, la página SÍ necesita
 * distinguir "candado cerrado" (mostrar el mismo bloque 🔒 que `mi-curso`) de
 * "paquete aún procesando/con error" (mensaje distinto, "contenido no
 * disponible aún") — ambos casos son legítimos y esperables para el DUEÑO de
 * la inscripción, no una fuga de información hacia terceros.
 */
export async function getStudentScormLessonView(
  principal: Principal,
  lessonId: string,
  nowMs: number = Date.now(),
): Promise<StudentScormLessonView> {
  if (!principal.tenantId) return { kind: "not_found" };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  const { data: lesson } = await guard
    .from("lessons")
    .select("id, course_id, content")
    .eq("id", lessonId)
    .eq("kind", "scorm")
    .eq("status", "published")
    .maybeSingle();
  if (!lesson) return { kind: "not_found" };

  const { data: pkg } = await guard
    .from("scorm_packages")
    .select("id, course_id, status, scorm_version, extracted_prefix, entry_href")
    .eq("id", lesson.content as string)
    .maybeSingle();
  if (!pkg || pkg.course_id !== lesson.course_id) return { kind: "not_found" };

  const enrollment = await resolveUnlockedEnrollment(guard, tenantId, principal.userId, lesson.course_id as string, nowMs);
  if (!enrollment) {
    // No distingue "no inscrito" de "candado cerrado": ambos requieren la
    // MISMA acción del alumno (volver a `mi-curso`, donde ve su estado real).
    return { kind: "locked" };
  }

  if (pkg.status !== "ready" || !isScormVersion(pkg.scorm_version as string | null) || !pkg.extracted_prefix || !pkg.entry_href) {
    return { kind: "not_ready" };
  }

  return {
    kind: "ok",
    access: {
      tenantId,
      enrollmentId: enrollment.id,
      lessonId: lesson.id as string,
      packageId: pkg.id as string,
      scormVersion: pkg.scorm_version as ScormVersion,
      extractedPrefix: pkg.extracted_prefix as string,
      entryHref: pkg.entry_href as string,
    },
  };
}

export interface CmiStateView {
  readonly cmi: Record<string, unknown>;
  readonly lessonStatus: string | null;
  readonly scoreRaw: number | null;
}

/** GET del endpoint CMI: null = sin acceso (la ruta lo mapea a 404). */
export async function getScormCmiState(principal: Principal, lessonId: string): Promise<CmiStateView | null> {
  const resolved = await resolveStudentScormAccess(principal, { by: "lesson", lessonId });
  if (!resolved.ok) return null;
  const { tenantId, enrollmentId, packageId } = resolved.access;
  const guard = tenantGuard(tenantId);
  const { data } = await guard.db
    .from("scorm_cmi")
    .select("data, lesson_status, score_raw")
    .eq("tenant_id", tenantId)
    .eq("enrollment_id", enrollmentId)
    .eq("package_id", packageId)
    .maybeSingle();
  if (!data) return { cmi: {}, lessonStatus: null, scoreRaw: null };
  return {
    cmi: (data.data as Record<string, unknown>) ?? {},
    lessonStatus: (data.lesson_status as string | null) ?? null,
    scoreRaw: data.score_raw === null || data.score_raw === undefined ? null : Number(data.score_raw),
  };
}

export type SaveCmiError = "not_found" | "too_large";
export type SaveCmiResult = { ok: true } | { ok: false; error: SaveCmiError };

/**
 * POST del endpoint CMI: valida acceso + presupuesto de bytes, deriva señales
 * (dominio puro `cmi.ts`), upsert de `scorm_cmi` y —si el intento se reporta
 * completo— marca `lesson_progress` reusando `setLessonProgress` (arriba).
 */
export async function saveScormCmiState(
  principal: Principal,
  lessonId: string,
  cmi: Record<string, unknown>,
): Promise<SaveCmiResult> {
  const resolved = await resolveStudentScormAccess(principal, { by: "lesson", lessonId });
  if (!resolved.ok) return { ok: false, error: "not_found" };
  if (JSON.stringify(cmi).length > MAX_CMI_BYTES) return { ok: false, error: "too_large" };

  const { tenantId, enrollmentId, packageId, scormVersion } = resolved.access;
  const guard = tenantGuard(tenantId);
  const signals = extractCmiSignals(scormVersion, cmi);

  const { error } = await guard.db.from("scorm_cmi").upsert(
    guard.withTenant({
      enrollment_id: enrollmentId,
      package_id: packageId,
      lesson_id: resolved.access.lessonId,
      data: cmi,
      lesson_status: signals.lessonStatus,
      score_raw: signals.scoreRaw,
    }),
    { onConflict: "enrollment_id,package_id" },
  );
  if (error) return { ok: false, error: "not_found" };

  if (signals.completed) {
    await setLessonProgress(principal, resolved.access.lessonId, true);
  }

  return { ok: true };
}

function studentName(first: string | null, last: string | null): string {
  return last ? `${last}, ${first ?? ""}`.replace(/,\s*$/, "") : (first ?? "").trim() || "—";
}

export interface ScormResultRow {
  readonly enrollmentId: string;
  readonly studentName: string;
  readonly lessonStatus: string | null;
  readonly scoreRaw: number | null;
  readonly updatedAt: string;
}

/** Resultados del paquete (staff): usado por el panel admin (task 5.1b, punto 5). */
export async function listScormResults(principal: Principal, packageId: string): Promise<ScormResultRow[]> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, RESULT_VIEWER_ROLES)) return [];
  const guard = tenantGuard(principal.tenantId);
  const { data } = await guard.db
    .from("scorm_cmi")
    .select("enrollment_id, lesson_status, score_raw, updated_at, enrollments!inner(first_names, last_names)")
    .eq("tenant_id", principal.tenantId)
    .eq("package_id", packageId)
    .order("updated_at", { ascending: false });

  return (data ?? []).map((row) => {
    const enr = (row as unknown as { enrollments: { first_names: string | null; last_names: string | null } }).enrollments;
    return {
      enrollmentId: row.enrollment_id as string,
      studentName: studentName(enr?.first_names ?? null, enr?.last_names ?? null),
      lessonStatus: (row.lesson_status as string | null) ?? null,
      scoreRaw: row.score_raw === null || row.score_raw === undefined ? null : Number(row.score_raw),
      updatedAt: row.updated_at as string,
    };
  });
}
