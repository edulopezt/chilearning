"use client";

import { useState } from "react";
import { RotateCcwIcon, Trash2Icon } from "lucide-react";

import { esCL } from "@/i18n/es-CL";
import type { ScormPackageRow } from "@/modules/contenido/scorm-service";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createScormLessonAction, deleteScormAction, retryScormAction } from "./actions";

const t = esCL.scorm;

export function PackageRowActions({ courseId, pkg }: { courseId: string; pkg: ScormPackageRow }) {
  const [lessonTitle, setLessonTitle] = useState(pkg.title);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {pkg.status === "error" ? (
        <Button variant="outline" size="sm" onClick={() => retryScormAction(courseId, pkg.id)}>
          <RotateCcwIcon />
          {t.retry}
        </Button>
      ) : null}
      {pkg.status === "ready" ? (
        <span className="flex items-center gap-1">
          <Input
            value={lessonTitle}
            onChange={(e) => setLessonTitle(e.target.value)}
            aria-label={t.titleLabel}
            className="h-9 w-32 text-sm"
          />
          <Button variant="outline" size="sm" onClick={() => createScormLessonAction(courseId, pkg.id, lessonTitle)}>
            {t.createLesson}
          </Button>
        </span>
      ) : null}
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={t.remove} title={t.remove} className="text-destructive">
              <Trash2Icon />
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteConfirm}</AlertDialogTitle>
            <AlertDialogDescription>{pkg.title}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{esCL.common.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleteScormAction(courseId, pkg.id)}>
              {t.remove}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
