import { redirect } from "next/navigation";

import Link from "next/link";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getScormCmiState, getStudentScormLessonView } from "@/modules/contenido/scorm-runtime-service";
import { ScormPlayer } from "./scorm-player";

export const dynamic = "force-dynamic";

/**
 * Página del reproductor SCORM (task 5.1b, HU-4.2, ADR-006). Vive en su
 * PROPIA ruta (no inline en `mi-curso`) por el tamaño del iframe. Aplica el
 * MISMO candado de asistencia que el resto del contenido del curso — no hay
 * excepción especial para SCORM (spec del PR).
 */
export default async function ScormLessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const { lessonId } = await params;
  const view = await getStudentScormLessonView(principal, lessonId);

  if (view.kind === "not_found") redirect("/mi-curso");

  if (view.kind === "locked") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col items-center justify-center gap-4 p-6 text-center">
        <div
          aria-hidden="true"
          className="w-full rounded-lg border border-dashed p-8 text-sm text-muted-foreground"
        >
          🔒 {esCL.course.lockedTitle}
        </div>
        <Link href="/mi-curso" className="text-sm underline">
          {esCL.scorm.backToCourse}
        </Link>
      </main>
    );
  }

  if (view.kind === "not_ready") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-muted-foreground text-sm">{esCL.scorm.notReadyYet}</p>
        <Link href="/mi-curso" className="text-sm underline">
          {esCL.scorm.backToCourse}
        </Link>
      </main>
    );
  }

  const { access } = view;
  const initialCmi = await getScormCmiState(principal, lessonId);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight">{esCL.scorm.playerTitle}</h1>
        <Link href="/mi-curso" className="text-sm underline">
          {esCL.scorm.backToCourse}
        </Link>
      </header>
      <ScormPlayer
        lessonId={access.lessonId}
        packageId={access.packageId}
        scormVersion={access.scormVersion}
        entryHref={access.entryHref}
        initialCmi={initialCmi?.cmi ?? {}}
      />
    </main>
  );
}
