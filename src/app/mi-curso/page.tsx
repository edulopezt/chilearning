import { redirect } from "next/navigation";

import Link from "next/link";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getStudentCourseView } from "@/modules/academico/course-view";
import { computeLock } from "@/modules/academico/domain/attendance-lock";
import { summarizeProgress } from "@/modules/academico/domain/progress";
import { listStudentQuizzes } from "@/modules/evaluacion/attempt-service";
import { listStudentAssignments } from "@/modules/evaluacion/assignment-service";
import { LessonComplete } from "./lesson-complete";
import { SessionCountdown } from "./session-countdown";

export const dynamic = "force-dynamic";

/**
 * Curso demo del alumno con candado SENCE (HU-5.2). El contenido se muestra solo
 * si la asistencia está registrada (sesión SENCE `iniciada` y vigente), salvo
 * alumnos exentos. El candado es regla de negocio en la app; RLS controla el
 * acceso al dato.
 */
export default async function MiCursoPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const view = await getStudentCourseView();
  if (!view) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{esCL.course.noCourse}</p>
      </main>
    );
  }

  // Server Component: renderiza una vez por request en el servidor, así que
  // Date.now() es determinista para este render (no es un componente cliente
  // que pueda re-renderizar con valores inestables).
  // eslint-disable-next-line react-hooks/purity
  const serverNowMs = Date.now();
  const lock = computeLock({
    exento: view.exento,
    attendanceLock: view.attendanceLock,
    sessionStatus: view.session?.status ?? null,
    expiresAtMs: view.session?.expiresAtMs ?? null,
    nowMs: serverNowMs,
  });

  const completedSet = new Set(view.completedLessonIds);
  // Evaluaciones del curso (task 2.1): visibles solo con el candado abierto,
  // como las lecciones.
  const quizzes = lock.unlocked ? await listStudentQuizzes(principal) : [];
  const assignments = lock.unlocked ? await listStudentAssignments(principal) : [];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{view.courseName}</h1>
        {view.exento ? (
          <p className="text-sm text-green-700 dark:text-green-400">{esCL.course.exento}</p>
        ) : null}
      </header>

      {/* Barra de estado de asistencia */}
      {!view.exento && view.attendanceLock ? (
        <section className="rounded-lg border p-4">
          {lock.action === "register" ? (
            <div className="flex flex-col gap-3">
              <p className="font-medium">{esCL.course.lockedTitle}</p>
              <p className="text-muted-foreground text-sm">{esCL.course.lockedBody}</p>
              {view.session?.status === "expirada" ? (
                <p className="text-sm text-amber-700 dark:text-amber-400">{esCL.course.expired}</p>
              ) : null}
              <form method="POST" action="/api/sence/start">
                <input type="hidden" name="enrollmentId" value={view.enrollmentId} />
                <button
                  type="submit"
                  className="min-h-11 w-full rounded-md bg-neutral-900 px-4 font-medium text-white sm:w-auto dark:bg-white dark:text-neutral-900"
                >
                  {esCL.course.register}
                </button>
              </form>
            </div>
          ) : null}

          {lock.action === "waiting" ? (
            <p className="text-sm">{esCL.course.waiting}</p>
          ) : null}

          {lock.action === "close" && view.session ? (
            <div className="flex flex-col gap-3">
              <p className="font-medium text-green-700 dark:text-green-400">
                {esCL.course.sessionActive}
              </p>
              {view.session.expiresAtMs != null ? (
                <SessionCountdown
                  expiresAtMs={view.session.expiresAtMs}
                  serverNowMs={serverNowMs}
                  label={esCL.course.timeLeft}
                  expiredLabel={esCL.course.expired}
                />
              ) : null}
              <form method="POST" action="/api/sence/close">
                <input type="hidden" name="sessionId" value={view.session.id} />
                <button
                  type="submit"
                  className="min-h-11 w-full rounded-md border px-4 text-sm font-medium sm:w-auto"
                >
                  {esCL.course.close}
                </button>
              </form>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Progreso del alumno (task 1.5) */}
      {lock.unlocked && view.lessons.length > 0 ? (() => {
        const p = summarizeProgress(view.lessons, completedSet);
        return (
          <section className="flex flex-col gap-2 rounded-lg border p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{esCL.course.progressLabel}</span>
              <span className="text-muted-foreground">
                {p.completed} {esCL.course.progressOf} {p.total} {esCL.course.lessonsWord} · {p.percent}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
              <div className="h-full rounded-full bg-green-600 transition-all" style={{ width: `${p.percent}%` }} />
            </div>
            {p.done ? (
              <p className="text-sm text-green-700 dark:text-green-400">{esCL.course.courseDone}</p>
            ) : p.resumeLessonId ? (
              <a href={`#leccion-${p.resumeLessonId}`} className="text-sm font-medium underline">
                {esCL.course.resume}
              </a>
            ) : null}
          </section>
        );
      })() : null}

      {/* Contenido del curso (candado) */}
      <section aria-labelledby="lessons-title" className="flex flex-col gap-4">
        <h2 id="lessons-title" className="text-lg font-semibold">
          {esCL.course.lessonsTitle}
        </h2>
        {lock.unlocked ? (
          <ol className="flex flex-col gap-4">
            {view.lessons.map((lesson) => (
              <li key={lesson.id} id={`leccion-${lesson.id}`} className="scroll-mt-4 rounded-lg border p-4">
                <h3 className="mb-2 font-medium">
                  {lesson.position}. {lesson.title}
                </h3>
                {lesson.kind === "video" || lesson.kind === "embed" ? (
                  <div className="aspect-video w-full overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-800">
                    <iframe
                      className="h-full w-full"
                      src={
                        lesson.content.startsWith("http")
                          ? lesson.content
                          : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(lesson.content)}`
                      }
                      title={lesson.title}
                      allowFullScreen
                    />
                  </div>
                ) : lesson.kind === "file" ? (
                  <a
                    href={lesson.content}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-2 rounded-md border px-4 text-sm font-medium"
                  >
                    📎 {esCL.course.openFile}
                  </a>
                ) : (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{lesson.content}</p>
                )}
                <LessonComplete lessonId={lesson.id} completed={completedSet.has(lesson.id)} />
              </li>
            ))}
          </ol>
        ) : (
          <div
            aria-hidden="true"
            className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
          >
            🔒 {esCL.course.lockedTitle}
          </div>
        )}
      </section>

      {/* Evaluaciones del curso (task 2.1, HU-6.1) */}
      {lock.unlocked && quizzes.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{esCL.quizStudent.sectionTitle}</h2>
          <ul className="flex flex-col gap-3">
            {quizzes.map((q) => (
              <li key={q.quizId}>
                <Link
                  href={`/mi-curso/quiz/${q.quizId}`}
                  className="flex flex-col gap-1 rounded-lg border p-4 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <span className="font-medium">{q.title}</span>
                  {q.description ? (
                    <span className="text-muted-foreground text-sm">{q.description}</span>
                  ) : null}
                  <span className="text-muted-foreground text-sm">
                    {q.attemptsUsed}
                    {q.maxAttempts !== null ? `/${q.maxAttempts}` : ""}{" "}
                    {esCL.quizStudent.attemptsUsed}
                    {" · "}
                    {esCL.quizStudent.bestGrade}:{" "}
                    <strong>{q.officialGrade !== null ? q.officialGrade.toFixed(1) : esCL.quizStudent.noGrade}</strong>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Tareas del curso (task 2.2, HU-6.2) */}
      {lock.unlocked && assignments.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{esCL.assignmentStudent.sectionTitle}</h2>
          <ul className="flex flex-col gap-3">
            {assignments.map((a) => (
              <li key={a.assignmentId}>
                <Link
                  href={`/mi-curso/tarea/${a.assignmentId}`}
                  className="flex flex-col gap-1 rounded-lg border p-4 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <span className="font-medium">{a.title}</span>
                  <span className="text-muted-foreground text-sm">
                    {a.dueAt
                      ? `${esCL.assignmentStudent.due}: ${new Date(a.dueAt).toLocaleDateString("es-CL")}`
                      : esCL.assignmentStudent.noDue}
                    {" · "}
                    {a.grade !== null ? (
                      <>
                        {esCL.assignmentStudent.yourGrade}: <strong>{a.grade.toFixed(1)}</strong>
                      </>
                    ) : a.submissionCount > 0 ? (
                      esCL.assignmentStudent.pending
                    ) : (
                      esCL.assignmentStudent.notSubmitted
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
