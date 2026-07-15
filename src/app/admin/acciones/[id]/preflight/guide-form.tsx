"use client";

import { useActionState } from "react";

import { esCL } from "@/i18n/es-CL";
import {
  markGuideSentAction,
  sendGuideAction,
  type GuideActionState,
} from "./actions";

const t = esCL.preflight.guide;

const ERROR_TEXT: Record<string, string> = {
  forbidden: esCL.preflight.forbidden,
  no_tenant: esCL.preflight.forbidden,
  not_found: esCL.preflight.notFound,
  not_configured: t.notConfigured,
};

/** Botones de la guía Clave Única: envío real + marca manual (fallback). */
export function GuideForm({ actionId }: { actionId: string }) {
  const [sendState, sendAction, sending] = useActionState<GuideActionState, FormData>(
    sendGuideAction,
    { status: "idle" },
  );
  const [markState, markAction, marking] = useActionState<GuideActionState, FormData>(
    markGuideSentAction,
    { status: "idle" },
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <form action={sendAction}>
          <input type="hidden" name="actionId" value={actionId} />
          <button
            type="submit"
            disabled={sending || marking}
            className="min-h-11 rounded-md bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
          >
            {t.sendButton}
          </button>
        </form>
        <form action={markAction}>
          <input type="hidden" name="actionId" value={actionId} />
          <button
            type="submit"
            disabled={sending || marking}
            className="min-h-11 rounded-md border px-4 font-medium disabled:opacity-60"
          >
            {t.markButton}
          </button>
        </form>
      </div>
      <p className="text-muted-foreground text-xs">{t.previewHint}</p>

      {sendState.status === "sent" ? (
        <p aria-live="polite" className="text-sm text-green-700 dark:text-green-400">
          {t.sentOk} <strong>{sendState.summary.sent}</strong> {t.summary}
          {sendState.summary.failed > 0 ? (
            <>
              {" · "}
              <strong className="text-red-600">{sendState.summary.failed}</strong>{" "}
              {t.summaryFailed}
            </>
          ) : null}
          {sendState.summary.skipped > 0 ? (
            <>
              {" · "}
              <strong>{sendState.summary.skipped}</strong> {t.summarySkipped}
            </>
          ) : null}
        </p>
      ) : null}
      {markState.status === "marked" ? (
        <p aria-live="polite" className="text-sm text-green-700 dark:text-green-400">
          {t.markedOk}
        </p>
      ) : null}
      {sendState.status === "error" ? (
        <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
          {ERROR_TEXT[sendState.error] ?? t.error}
        </p>
      ) : null}
      {markState.status === "error" ? (
        <p role="alert" className="text-sm text-red-600">
          {ERROR_TEXT[markState.error] ?? t.error}
        </p>
      ) : null}
    </div>
  );
}
