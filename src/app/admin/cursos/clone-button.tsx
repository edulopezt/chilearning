"use client";

import { useState, useTransition } from "react";

import { esCL } from "@/i18n/es-CL";
import { cloneCourseAction } from "./actions";

const t = esCL.courses;

/** Botón de clonado de curso (task 2.8): copia completa en borrador. */
export function CloneButton({ courseId }: { courseId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(false);
            const result = await cloneCourseAction(courseId);
            if (!result.ok) setError(true);
          })
        }
        className="text-sm underline disabled:opacity-60"
      >
        {pending ? t.cloning : t.clone}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-red-600">
          {t.cloneError}
        </span>
      ) : null}
    </span>
  );
}
