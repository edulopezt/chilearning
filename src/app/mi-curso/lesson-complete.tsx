"use client";

import { useTransition } from "react";
import { CheckIcon } from "lucide-react";

import { esCL } from "@/i18n/es-CL";
import { Button } from "@/components/ui/button";
import { setLessonProgressAction } from "./actions";

export function LessonComplete({ lessonId, completed }: { lessonId: string; completed: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant={completed ? "outline" : "default"}
      loading={pending}
      onClick={() => start(() => setLessonProgressAction(lessonId, !completed))}
      className="mt-3"
    >
      {completed ? <CheckIcon className="size-4" aria-hidden="true" /> : null}
      {completed ? esCL.course.completed : esCL.course.markComplete}
    </Button>
  );
}
