"use client";

import { useActionState, useState } from "react";

import { esCL } from "@/i18n/es-CL";
import type { LessonKind } from "@/modules/academico/domain/lesson";
import type { LessonMutationResult } from "@/modules/academico/lesson-service";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldControl, FieldError, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
      <FieldRoot invalid={!!errors.title}>
        <FieldLabel>{t.titleLabel}</FieldLabel>
        <FieldControl name="title" required maxLength={200} />
        {errors.title ? <FieldError>{errors.title}</FieldError> : null}
      </FieldRoot>

      <div className="grid gap-5 sm:grid-cols-2">
        <FieldRoot>
          <FieldLabel>{t.kindLabel}</FieldLabel>
          <Select value={kind} onValueChange={(v) => setKind(v as LessonKind)} name="kind">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">{t.kindText}</SelectItem>
              <SelectItem value="video">{t.kindVideo}</SelectItem>
              <SelectItem value="file">{t.kindFile}</SelectItem>
              <SelectItem value="embed">{t.kindEmbed}</SelectItem>
            </SelectContent>
          </Select>
        </FieldRoot>
        <FieldRoot>
          <FieldLabel>{t.statusLabel}</FieldLabel>
          <Select name="status" defaultValue="draft">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">{t.statusDraft}</SelectItem>
              <SelectItem value="published">{t.statusPublished}</SelectItem>
            </SelectContent>
          </Select>
        </FieldRoot>
      </div>

      <FieldRoot invalid={!!errors.content}>
        <FieldLabel>{CONTENT_LABEL[kind]}</FieldLabel>
        {kind === "text" ? (
          <FieldControl name="content" required render={<Textarea rows={5} />} />
        ) : (
          <FieldControl
            name="content"
            required
            placeholder={kind === "video" ? "dQw4w9WgXcQ  ó  https://vz-…/play.m3u8" : "https://…"}
            className="font-mono text-sm"
          />
        )}
        {errors.content ? <FieldError>{errors.content}</FieldError> : null}
      </FieldRoot>

      {state?.ok ? (
        <Alert variant="success" role="status" className="w-auto">
          <AlertDescription>{t.saved}</AlertDescription>
        </Alert>
      ) : null}
      {state && !state.ok && "error" in state ? (
        <Alert variant="destructive" role="alert" className="w-auto">
          <AlertDescription>{t.genericError}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" loading={pending} className="w-full sm:w-auto">
        {t.save}
      </Button>
    </form>
  );
}
