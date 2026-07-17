"use client";

import { useState } from "react";

import { esCL } from "@/i18n/es-CL";
import type { ScormPackageRow } from "@/modules/contenido/scorm-service";
import { createScormLessonAction, deleteScormAction, retryScormAction } from "./actions";

const t = esCL.scorm;

export function PackageRowActions({ courseId, pkg }: { courseId: string; pkg: ScormPackageRow }) {
  const [lessonTitle, setLessonTitle] = useState(pkg.title);
  const btn = "inline-flex min-h-11 items-center justify-center rounded border px-2 text-sm disabled:opacity-30";

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {pkg.status === "error" ? (
        <button className={btn} onClick={() => retryScormAction(courseId, pkg.id)}>
          {t.retry}
        </button>
      ) : null}
      {pkg.status === "ready" ? (
        <span className="flex items-center gap-1">
          <input
            value={lessonTitle}
            onChange={(e) => setLessonTitle(e.target.value)}
            aria-label={t.titleLabel}
            className="min-h-11 w-32 rounded border px-2 text-sm"
          />
          <button className={btn} onClick={() => createScormLessonAction(courseId, pkg.id, lessonTitle)}>
            {t.createLesson}
          </button>
        </span>
      ) : null}
      <button
        className={`${btn} text-red-600`}
        title={t.remove}
        onClick={() => {
          if (confirm(`${t.deleteConfirm} — ${pkg.title}`)) deleteScormAction(courseId, pkg.id);
        }}
      >
        🗑
      </button>
    </div>
  );
}
