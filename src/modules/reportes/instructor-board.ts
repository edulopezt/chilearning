import "server-only";

import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { semaforo, type Semaforo } from "@/modules/reportes/domain/semaforo";

/**
 * Tablero del relator (task 1.8, HU-3.4): por cada acción, el avance promedio
 * del contenido, la asistencia SENCE y un semáforo de riesgo. Lectura agregada
 * vía tenantGuard, para relator/coordinador/admin. (El acotado "sus cursos" del
 * relator requiere el modelo de asignación por curso — follow-up.)
 */

export interface ActionBoardRow {
  actionId: string;
  courseName: string;
  code: string;
  enrolled: number;
  avgProgressPct: number;
  attendanceRatePct: number;
  semaforo: Semaforo;
}

const VIEWERS = ["otec_admin", "coordinator", "instructor", "tutor"] as const;

export async function getInstructorBoard(principal: Principal): Promise<ActionBoardRow[]> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, VIEWERS)) return [];
  const guard = tenantGuard(principal.tenantId);

  const [actions, courses, lessons, enrollments, progress, sessions] = await Promise.all([
    guard.from("actions").select("id, course_id, codigo_accion, attendance_lock"),
    guard.from("courses").select("id, name"),
    guard.from("lessons").select("id, course_id, status"),
    guard.from("enrollments").select("id, action_id, exento"),
    guard.from("lesson_progress").select("enrollment_id, completed"),
    guard.from("sence_sessions").select("enrollment_id, status"),
  ]);

  const courseName = new Map((courses.data ?? []).map((c) => [c.id as string, c.name as string]));

  const publishedByCourse = new Map<string, number>();
  for (const l of lessons.data ?? []) {
    if (l.status === "published") {
      publishedByCourse.set(l.course_id as string, (publishedByCourse.get(l.course_id as string) ?? 0) + 1);
    }
  }

  const completedByEnrollment = new Map<string, number>();
  for (const p of progress.data ?? []) {
    if (p.completed) {
      completedByEnrollment.set(p.enrollment_id as string, (completedByEnrollment.get(p.enrollment_id as string) ?? 0) + 1);
    }
  }

  const registered = new Set(
    (sessions.data ?? [])
      .filter((s) => s.status === "iniciada" || s.status === "cerrada")
      .map((s) => s.enrollment_id as string),
  );

  const enrollmentsByAction = new Map<string, { id: string; exento: boolean }[]>();
  for (const e of enrollments.data ?? []) {
    const list = enrollmentsByAction.get(e.action_id as string) ?? [];
    list.push({ id: e.id as string, exento: Boolean(e.exento) });
    enrollmentsByAction.set(e.action_id as string, list);
  }

  const rows: ActionBoardRow[] = (actions.data ?? []).map((a) => {
    const actionId = a.id as string;
    const courseId = a.course_id as string;
    const list = enrollmentsByAction.get(actionId) ?? [];
    const enrolled = list.length;
    const totalLessons = publishedByCourse.get(courseId) ?? 0;

    const avgProgressPct =
      enrolled === 0 || totalLessons === 0
        ? 0
        : Math.round(
            (list.reduce((sum, e) => sum + Math.min(1, (completedByEnrollment.get(e.id) ?? 0) / totalLessons), 0) / enrolled) * 100,
          );

    const attended = list.filter((e) => e.exento || registered.has(e.id)).length;
    const attendanceRatePct = enrolled === 0 ? 0 : Math.round((attended / enrolled) * 100);

    return {
      actionId,
      courseName: courseName.get(courseId) ?? "—",
      code: a.codigo_accion as string,
      enrolled,
      avgProgressPct,
      attendanceRatePct,
      semaforo: semaforo({ enrolled, avgProgressPct, attendanceRatePct, requiresAttendance: Boolean(a.attendance_lock) }),
    };
  });

  // Rojo primero (lo que necesita atención).
  return rows.sort((x, y) => x.semaforo.score - y.semaforo.score);
}
