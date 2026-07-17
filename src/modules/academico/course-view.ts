import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SenceSessionStatus } from "@/modules/academico/domain/attendance-lock";

/**
 * Lee, con la sesión del alumno (RLS), su inscripción demo: curso, lecciones,
 * acción (candado) y el estado de su última sesión SENCE. Todo acotado por RLS
 * al propio alumno y su tenant.
 */

export interface Lesson {
  id: string;
  title: string;
  kind: "text" | "video" | "file" | "embed" | "scorm";
  content: string;
  position: number;
}

export interface CourseView {
  enrollmentId: string;
  courseId: string;
  courseName: string;
  exento: boolean;
  /** Código SENCE del curso (para la etiqueta de grupo del alumno, HU-2.2). */
  codSence: string | null;
  attendanceLock: boolean;
  lessons: Lesson[];
  /** ids de lecciones que el alumno ya completó (task 1.5). */
  completedLessonIds: string[];
  /** Nota (score_raw) del último intento SCORM por lección, si existe (task 5.1b, informativo). */
  scormScoreByLesson: Record<string, number | null>;
  session: {
    id: string;
    status: SenceSessionStatus;
    /** Origen del `error` (T3/T7), para ofrecer el reintento de cierre (Q-05). */
    errorOrigin: "start" | "close" | null;
    /** Códigos del último `GlosaError` (I-5), para traducir el mensaje al alumno (H4-R-010). */
    errorCodes: string[];
    expiresAtMs: number | null;
  } | null;
}

/** Devuelve la primera inscripción del alumno autenticado, o null. */
export async function getStudentCourseView(): Promise<CourseView | null> {
  const supabase = await createSupabaseServerClient();

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id, exento, action_id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!enrollment) return null;

  const { data: action } = await supabase
    .from("actions")
    .select("id, course_id, attendance_lock")
    .eq("id", enrollment.action_id)
    .maybeSingle();
  if (!action) return null;

  const { data: course } = await supabase
    .from("courses")
    .select("id, name, cod_sence")
    .eq("id", action.course_id)
    .maybeSingle();
  if (!course) return null;

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, title, kind, content, position")
    .eq("course_id", course.id)
    .eq("status", "published") // el alumno solo ve lecciones publicadas (1.4)
    .order("position", { ascending: true });

  const { data: session } = await supabase
    .from("sence_sessions")
    .select("id, status, expires_at, error_origin, error_codes")
    .eq("enrollment_id", enrollment.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Progreso: lecciones completadas por esta inscripción (RLS = propias).
  const { data: progress } = await supabase
    .from("lesson_progress")
    .select("lesson_id")
    .eq("enrollment_id", enrollment.id)
    .eq("completed", true);

  // Nota SCORM por lección (task 5.1b, informativo): RLS ya acota a las filas
  // de la propia inscripción (`scorm_cmi_select`).
  const { data: scormResults } = await supabase
    .from("scorm_cmi")
    .select("lesson_id, score_raw")
    .eq("enrollment_id", enrollment.id);
  const scormScoreByLesson: Record<string, number | null> = {};
  for (const r of scormResults ?? []) {
    scormScoreByLesson[r.lesson_id as string] = r.score_raw === null || r.score_raw === undefined ? null : Number(r.score_raw);
  }

  return {
    enrollmentId: enrollment.id,
    courseId: course.id,
    courseName: course.name,
    exento: enrollment.exento,
    codSence: (course.cod_sence as string | null) ?? null,
    attendanceLock: action.attendance_lock,
    lessons: (lessons ?? []) as Lesson[],
    completedLessonIds: (progress ?? []).map((r) => r.lesson_id as string),
    scormScoreByLesson,
    session: session
      ? {
          id: session.id,
          status: session.status as SenceSessionStatus,
          errorOrigin: (session.error_origin as "start" | "close" | null) ?? null,
          errorCodes: (session.error_codes as string[] | null) ?? [],
          expiresAtMs: session.expires_at ? Date.parse(session.expires_at) : null,
        }
      : null,
  };
}
