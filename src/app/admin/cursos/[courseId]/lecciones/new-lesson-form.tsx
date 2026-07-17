"use client";

import { useActionState, useState } from "react";

import { esCL } from "@/i18n/es-CL";
import type { LessonKind } from "@/modules/academico/domain/lesson";
import type { LessonMutationResult } from "@/modules/academico/lesson-service";
import { createLessonAction } from "./actions";

const t = esCL.lessons;

const CONTENT_LABEL: Record<LessonKind, string> = {
  text: t.contentTextLabel,
  video: t.contentVideoLabel,
  file: t.contentFileLabel,
  embed: t.contentEmbedLabel,
  // Las lecciones `scorm` NO se crean desde este formulario (no está en el
  // <select> de abajo): se crean desde /admin/cursos/[courseId]/scorm cuando
  // el paquete queda `ready`. La etiqueta solo satisface la exhaustividad del Record.
  scorm: "",
};

function fieldErrors(state: LessonMutationResult | null): Record<string, string> {
  if (state && !state.ok && "validation" in state) {
    return Object.fromEntries(state.validation.map((e) => [e.field, e.message]));
  }
  return {};
}

export function NewLessonForm({ courseId }: { courseId: string }) {
  const action = createLessonAction.bind(null, courseId);
  const [state, formAction, pending] = useActionState<LessonMutationResult | null, FormData>(action, null);
  const [kind, setKind] = useState<LessonKind>("text");
  const errors = fieldErrors(state);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1 text-sm">
        {t.titleLabel}
        <input name="title" required maxLength={200} className="min-h-11 rounded-md border px-3 text-base" />
        {errors.title ? <span className="text-xs text-red-600">{errors.title}</span> : null}
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          {t.kindLabel}
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as LessonKind)}
            className="min-h-11 rounded-md border px-3 text-base"
          >
            <option value="text">{t.kindText}</option>
            <option value="video">{t.kindVideo}</option>
            <option value="file">{t.kindFile}</option>
            <option value="embed">{t.kindEmbed}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.statusLabel}
          <select name="status" defaultValue="draft" className="min-h-11 rounded-md border px-3 text-base">
            <option value="draft">{t.statusDraft}</option>
            <option value="published">{t.statusPublished}</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        {CONTENT_LABEL[kind]}
        {kind === "text" ? (
          <textarea name="content" required rows={5} className="rounded-md border px-3 py-2 text-base" />
        ) : (
          <input
            name="content"
            required
            placeholder={kind === "video" ? "dQw4w9WgXcQ  ó  https://vz-…/play.m3u8" : "https://…"}
            className="min-h-11 rounded-md border px-3 font-mono text-sm"
          />
        )}
        {errors.content ? <span className="text-xs text-red-600">{errors.content}</span> : null}
      </label>

      {state?.ok ? <p role="status" className="text-sm text-green-700 dark:text-green-400">{t.saved}</p> : null}
      {state && !state.ok && "error" in state ? <p role="alert" className="text-sm text-red-600">{t.genericError}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-md bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 sm:w-auto dark:bg-white dark:text-neutral-900"
      >
        {t.save}
      </button>
    </form>
  );
}
