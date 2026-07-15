"use client";

import { useTransition } from "react";

import { esCL } from "@/i18n/es-CL";
import { setLessonProgressAction } from "./actions";

export function LessonComplete({ lessonId, completed }: { lessonId: string; completed: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => setLessonProgressAction(lessonId, !completed))}
      className={`mt-3 inline-flex min-h-11 items-center gap-2 rounded-md px-4 text-sm font-medium disabled:opacity-60 ${
        completed
          ? "border text-green-700 dark:text-green-400"
          : "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
      }`}
    >
      {completed ? esCL.course.completed : esCL.course.markComplete}
    </button>
  );
}
