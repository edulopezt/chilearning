import { redirect } from "next/navigation";

import Link from "next/link";
import { CheckIcon, LockIcon, PaperclipIcon } from "lucide-react";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getStudentCourseView } from "@/modules/academico/course-view";
import { computeLock } from "@/modules/academico/domain/attendance-lock";
import { canSelfMark } from "@/modules/academico/domain/live-session";
import { enrollmentGroupLabel } from "@/modules/academico/domain/enrollment-group";
// Excepción documentada al aislamiento de src/modules/sence/ (CLAUDE.md): studentMessageForCodes
// es la tabla de traducción de errores SENCE al alumno (nunca códigos crudos) — es la fuga de
// presentación que la propia regla permite explícitamente, no una violación.
import { studentMessageForCodes } from "@/modules/sence/errors";
import { listMySessions } from "@/modules/academico/live-session-service";
import { summarizeProgress } from "@/modules/academico/domain/progress";
import { listStudentQuizzes } from "@/modules/evaluacion/attempt-service";
import { listStudentAssignments } from "@/modules/evaluacion/assignment-service";
import { listStudentSurveys } from "@/modules/evaluacion/survey-service";
import { hasCurrentConsent } from "@/modules/core/privacy-service";
import { resolveTutorContext } from "@/modules/tutor-ia/tutor-chat-service";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { LessonComplete } from "./lesson-complete";
import { LiveSessionMark } from "./live-session-mark";
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

  // Consentimiento al primer ingreso (task 3.5, RNF-3): el alumno debe aceptar
  // antes de usar la plataforma.
  if (principal.roles.includes("student") && !(await hasCurrentConsent(principal))) {
    redirect("/consentimiento");
  }

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
    errorOrigin: view.session?.errorOrigin ?? null,
    expiresAtMs: view.session?.expiresAtMs ?? null,
    nowMs: serverNowMs,
  });

  const completedSet = new Set(view.completedLessonIds);
  // Evaluaciones del curso (task 2.1): visibles solo con el candado abierto,
  // como las lecciones.
  const quizzes = lock.unlocked ? await listStudentQuizzes(principal) : [];
  const assignments = lock.unlocked ? await listStudentAssignments(principal) : [];
  const surveys = lock.unlocked ? await listStudentSurveys(principal) : [];

  // Sesiones en vivo (task 5.4, spec §7-R3): asistencia INTERNA, independiente
  // del candado SENCE — se muestran SIEMPRE, nunca detrás de `lock.unlocked`.
  const upcomingSessions = (await listMySessions(principal)).filter((s) => s.endsAtMs >= serverNowMs);

  // Tutor IA (task 5.8b, HU-11.1): la función DESAPARECE si no está disponible
  // (feature apagada, curso sin config, sin proveedor, etc.) — mismo criterio
  // que SCORM, nunca se muestra deshabilitada a medias.
  const tutorGate = await resolveTutorContext(principal);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{view.courseName}</h1>
        {/* Grupo operativo del OTEC (HU-2.2). Solo para el alumno SENCE: al
            becario ya se lo dice el mensaje verde de exento (4-ojos H4: evitar
            "Tu grupo: Becario" + "(becario/a)" duplicados). */}
        {(() => {
          const group = view.exento ? null : enrollmentGroupLabel(false, view.codSence);
          return group ? (
            <p className="text-sm text-muted-foreground">
              {esCL.course.groupLabel} <strong>{group}</strong>
            </p>
          ) : null;
        })()}
        {view.exento ? <p className="text-sm text-success">{esCL.course.exento}</p> : null}
        <div className="flex flex-wrap gap-4">
          <Link href="/mi-curso/certificados" className="text-sm underline underline-offset-4">
            {esCL.certificateStudent.sectionTitle} →
          </Link>
          <Link href="/mi-curso/comunicacion" className="text-sm underline underline-offset-4">
            {esCL.communication.title} →
          </Link>
          <Link href="/mis-datos" className="text-sm underline underline-offset-4">
            {esCL.dataRights.title} →
          </Link>
        </div>
      </header>

      {/* Tutor IA (task 5.8b, HU-11.1): oculto por completo si no está disponible. */}
      {tutorGate.ok ? (
        <Card className="flex-row flex-wrap items-center justify-between gap-2 p-4">
          <p className="text-sm font-medium">{esCL.tutorIA.studentLinkBanner}</p>
          <Link href="/mi-curso/tutor" className="text-sm font-medium underline underline-offset-4">
            {esCL.tutorIA.studentLinkCta}
          </Link>
        </Card>
      ) : null}

      {/* Barra de estado de asistencia */}
      {!view.exento && view.attendanceLock ? (
        <Card className="p-4">
          {/* Mensaje es-CL cuando SENCE devolvió un error (H4-R-010, I-9): el alumno
              ve QUÉ pasó y qué hacer, nunca el código crudo ni JSON técnico. Se muestra
              para CUALQUIER `error` (aun sin códigos parseables): `studentMessageForCodes`
              resuelve la lista vacía al mensaje `fallback` seguro (4-ojos LOW). */}
          {view.session?.status === "error" ? (
            <Alert variant="warning" role="alert" className="mb-3">
              <AlertTitle>{esCL.course.attendanceProblem}</AlertTitle>
              <AlertDescription>{studentMessageForCodes(view.session.errorCodes)}</AlertDescription>
            </Alert>
          ) : null}

          {lock.action === "register" ? (
            <div className="flex flex-col gap-3">
              <p className="font-medium">{esCL.course.lockedTitle}</p>
              <p className="text-sm text-muted-foreground">{esCL.course.lockedBody}</p>
              {view.session?.status === "expirada" ? (
                <p className="text-sm text-warning">{esCL.course.expired}</p>
              ) : null}
              <form method="POST" action="/api/sence/start">
                <input type="hidden" name="enrollmentId" value={view.enrollmentId} />
                <button type="submit" className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}>
                  {esCL.course.register}
                </button>
              </form>
            </div>
          ) : null}

          {lock.action === "waiting" ? <p className="text-sm">{esCL.course.waiting}</p> : null}

          {lock.action === "close" && view.session ? (
            <div className="flex flex-col gap-3">
              <p className="font-medium text-success">{esCL.course.sessionActive}</p>
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
                  className={cn(buttonVariants({ variant: "outline" }), "w-full sm:w-auto")}
                >
                  {esCL.course.close}
                </button>
              </form>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Sesiones en vivo (task 5.4, spec §7-R3): asistencia INTERNA, no SENCE.
          Se muestra SIEMPRE (no depende del candado), disclaimer incluido. */}
      <Card className="gap-3 p-4">
        <h2 className="text-lg font-semibold">{esCL.liveSessions.sectionTitleStudent}</h2>
        <p className="text-xs text-warning">{esCL.liveSessions.disclaimer}</p>
        {upcomingSessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{esCL.liveSessions.emptyStudent}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {upcomingSessions.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-2 rounded-md border p-3 text-sm sm:flex-row sm:flex-wrap sm:items-center"
              >
                <div className="flex-1">
                  <p className="font-medium">{s.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {esCL.liveSessions.providers[s.provider]} · {new Date(s.startsAtMs).toLocaleString("es-CL")} →{" "}
                    {new Date(s.endsAtMs).toLocaleString("es-CL")}
                  </p>
                </div>
                <a href={s.meetingUrl} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants())}>
                  {esCL.liveSessions.join}
                </a>
                <LiveSessionMark sessionId={s.id} canMark={canSelfMark(s.startsAtMs, s.endsAtMs, serverNowMs)} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Progreso del alumno (task 1.5) */}
      {lock.unlocked && view.lessons.length > 0
        ? (() => {
            const p = summarizeProgress(view.lessons, completedSet);
            return (
              <Card className="gap-2 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{esCL.course.progressLabel}</span>
                  <span className="text-muted-foreground">
                    {p.completed} {esCL.course.progressOf} {p.total} {esCL.course.lessonsWord} · {p.percent}%
                  </span>
                </div>
                <Progress value={p.percent} />
                {p.done ? (
                  <p className="text-sm text-success">{esCL.course.courseDone}</p>
                ) : p.resumeLessonId ? (
                  <a href={`#leccion-${p.resumeLessonId}`} className="text-sm font-medium underline underline-offset-4">
                    {esCL.course.resume}
                  </a>
                ) : null}
              </Card>
            );
          })()
        : null}

      {/* Contenido del curso (candado) */}
      <section aria-labelledby="lessons-title" className="flex flex-col gap-4">
        <h2 id="lessons-title" className="text-lg font-semibold">
          {esCL.course.lessonsTitle}
        </h2>
        {lock.unlocked ? (
          <ol className="flex flex-col gap-4">
            {view.lessons.map((lesson) => (
              <li key={lesson.id} id={`leccion-${lesson.id}`} className="scroll-mt-4">
                <Card className="p-4">
                  <h3 className="mb-2 font-medium">
                    {lesson.position}. {lesson.title}
                  </h3>
                  {lesson.kind === "video" || lesson.kind === "embed" ? (
                    <div className="aspect-video w-full overflow-hidden rounded-md bg-muted">
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
                      className={cn(buttonVariants({ variant: "outline" }))}
                    >
                      <PaperclipIcon className="size-4" aria-hidden="true" />
                      {esCL.course.openFile}
                    </a>
                  ) : lesson.kind === "scorm" ? (
                    // El reproductor SCORM vive en su PROPIA página (el iframe
                    // necesita bastante alto): aquí solo un enlace de entrada.
                    <Link href={`/mi-curso/scorm/${lesson.id}`} className={cn(buttonVariants())}>
                      {esCL.scorm.openLesson}
                    </Link>
                  ) : (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{lesson.content}</p>
                  )}
                  {lesson.kind === "scorm" ? (
                    // Completitud/nota SCORM las fija el reproductor (CMI), no
                    // un botón manual: badge puramente informativo.
                    completedSet.has(lesson.id) ? (
                      <p className="mt-3 flex items-center gap-1.5 text-sm text-success">
                        <CheckIcon className="size-4" aria-hidden="true" />
                        {esCL.scorm.completedBadge}
                        {view.scormScoreByLesson[lesson.id] != null
                          ? ` · ${esCL.scorm.scoreLabel}: ${view.scormScoreByLesson[lesson.id]}`
                          : ""}
                      </p>
                    ) : null
                  ) : (
                    <LessonComplete lessonId={lesson.id} completed={completedSet.has(lesson.id)} />
                  )}
                </Card>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            icon={<LockIcon />}
            title={esCL.course.lockedTitle}
            description={esCL.course.lockedBody}
          />
        )}
      </section>

      {/* Evaluaciones del curso (task 2.1, HU-6.1) */}
      {lock.unlocked && quizzes.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{esCL.quizStudent.sectionTitle}</h2>
          <ul className="flex flex-col gap-3">
            {quizzes.map((q) => (
              <li key={q.quizId}>
                <Link href={`/mi-curso/quiz/${q.quizId}`} className="block">
                  <Card className="gap-1 p-4 transition-colors hover:bg-accent/50">
                    <span className="font-medium">{q.title}</span>
                    {q.description ? (
                      <span className="text-sm text-muted-foreground">{q.description}</span>
                    ) : null}
                    <span className="text-sm text-muted-foreground">
                      {q.attemptsUsed}
                      {q.maxAttempts !== null ? `/${q.maxAttempts}` : ""} {esCL.quizStudent.attemptsUsed}
                      {" · "}
                      {esCL.quizStudent.bestGrade}:{" "}
                      <strong>{q.officialGrade !== null ? q.officialGrade.toFixed(1) : esCL.quizStudent.noGrade}</strong>
                    </span>
                  </Card>
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
                <Link href={`/mi-curso/tarea/${a.assignmentId}`} className="block">
                  <Card className="gap-1 p-4 transition-colors hover:bg-accent/50">
                    <span className="font-medium">{a.title}</span>
                    <span className="text-sm text-muted-foreground">
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
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Encuesta de satisfacción (task 3.1, HU-6.3) */}
      {lock.unlocked && surveys.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{esCL.surveyStudent.sectionTitle}</h2>
          <ul className="flex flex-col gap-3">
            {surveys.map((s) => (
              <li key={s.surveyId}>
                <Link href={`/mi-curso/encuesta/${s.surveyId}`} className="block">
                  <Card className="flex-row items-center justify-between gap-3 p-4 transition-colors hover:bg-accent/50">
                    <span className="font-medium">{s.title}</span>
                    <Badge variant={s.alreadySubmitted ? "success" : "warning"}>
                      {s.alreadySubmitted ? esCL.surveyStudent.done : esCL.surveyStudent.pending}
                    </Badge>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
