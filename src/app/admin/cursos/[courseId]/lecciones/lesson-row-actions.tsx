"use client";

import { ChevronDownIcon, ChevronUpIcon, EyeIcon, EyeOffIcon, Trash2Icon } from "lucide-react";

import { esCL } from "@/i18n/es-CL";
import type { LessonRow } from "@/modules/academico/lesson-service";
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

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t.moveUp}
        title={t.moveUp}
        disabled={isFirst}
        onClick={() => moveLessonAction(courseId, lesson.id, "up")}
      >
        <ChevronUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t.moveDown}
        title={t.moveDown}
        disabled={isLast}
        onClick={() => moveLessonAction(courseId, lesson.id, "down")}
      >
        <ChevronDownIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={lesson.status === "published" ? t.unpublish : t.publish}
        title={lesson.status === "published" ? t.unpublish : t.publish}
        onClick={() =>
          togglePublishAction(courseId, lesson.id, nextStatus, lesson.title, lesson.kind, lesson.content)
        }
      >
        {lesson.status === "published" ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
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
            <AlertDialogTitle>{t.remove}</AlertDialogTitle>
            <AlertDialogDescription>{lesson.title}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{esCL.common.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleteLessonAction(courseId, lesson.id)}>
              {t.remove}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
