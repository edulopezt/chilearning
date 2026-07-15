"use client";

import { esCL } from "@/i18n/es-CL";
import type { LessonRow } from "@/modules/academico/lesson-service";
import { deleteLessonAction, moveLessonAction, togglePublishAction } from "./actions";

const t = esCL.lessons;

export function LessonRowActions({
  courseId,
  lesson,
  isFirst,
  isLast,
}: {
  courseId: string;
  lesson: LessonRow;
  isFirst: boolean;
  isLast: boolean;
}) {
  const nextStatus = lesson.status === "published" ? "draft" : "published";
  const btn = "inline-flex min-h-9 min-w-9 items-center justify-center rounded border px-2 disabled:opacity-30";

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <button className={btn} title={t.moveUp} disabled={isFirst} onClick={() => moveLessonAction(courseId, lesson.id, "up")}>
        ↑
      </button>
      <button className={btn} title={t.moveDown} disabled={isLast} onClick={() => moveLessonAction(courseId, lesson.id, "down")}>
        ↓
      </button>
      <button
        className={btn}
        onClick={() =>
          togglePublishAction(courseId, lesson.id, nextStatus, lesson.title, lesson.kind, lesson.content)
        }
      >
        {lesson.status === "published" ? t.unpublish : t.publish}
      </button>
      <button
        className={`${btn} text-red-600`}
        title={t.remove}
        onClick={() => {
          if (confirm(`${t.remove}: ${lesson.title}?`)) deleteLessonAction(courseId, lesson.id);
        }}
      >
        🗑
      </button>
    </div>
  );
}
