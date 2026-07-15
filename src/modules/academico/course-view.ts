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
  kind: "text" | "video" | "file" | "embed";
  content: string;
  position: number;
}

export interface CourseView {
  enrollmentId: string;
  courseName: string;
  exento: boolean;
  attendanceLock: boolean;
  lessons: Lesson[];
  /** ids de lecciones que el alumno ya completó (task 1.5). */
  completedLessonIds: string[];
  session: {
    id: string;
    status: SenceSessionStatus;
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
    .select("id, name")
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
    .select("id, status, expires_at")
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

  return {
    enrollmentId: enrollment.id,
    courseName: course.name,
    exento: enrollment.exento,
    attendanceLock: action.attendance_lock,
    lessons: (lessons ?? []) as Lesson[],
    completedLessonIds: (progress ?? []).map((r) => r.lesson_id as string),
    session: session
      ? {
          id: session.id,
          status: session.status as SenceSessionStatus,
          expiresAtMs: session.expires_at ? Date.parse(session.expires_at) : null,
        }
      : null,
  };
}
