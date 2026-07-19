"use client";

import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
  audit_failed: t.auditFailed,
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
          <Button type="submit" loading={sending} disabled={marking}>
            {t.sendButton}
          </Button>
        </form>
        <form action={markAction}>
          <input type="hidden" name="actionId" value={actionId} />
          <Button type="submit" variant="outline" loading={marking} disabled={sending}>
            {t.markButton}
          </Button>
        </form>
      </div>
      <p className="text-muted-foreground text-xs">{t.previewHint}</p>

      {sendState.status === "sent" ? (
        <Alert variant="success" role="status">
          <AlertDescription>
            {t.sentOk} <strong>{sendState.summary.sent}</strong> {t.summary}
            {sendState.summary.failed > 0 ? (
              <>
                {" · "}
                <strong className="text-destructive">{sendState.summary.failed}</strong>{" "}
                {t.summaryFailed}
              </>
            ) : null}
            {sendState.summary.skipped > 0 ? (
              <>
                {" · "}
                <strong>{sendState.summary.skipped}</strong> {t.summarySkipped}
              </>
            ) : null}
            {!sendState.audited ? (
              <>
                {" — "}
                <span className="text-warning">{t.sentUnaudited}</span>
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {markState.status === "marked" ? (
        <Alert variant="success" role="status">
          <AlertDescription>{t.markedOk}</AlertDescription>
        </Alert>
      ) : null}
      {sendState.status === "error" ? (
        <Alert variant="warning" role="alert">
          <AlertDescription>{ERROR_TEXT[sendState.error] ?? t.error}</AlertDescription>
        </Alert>
      ) : null}
      {markState.status === "error" ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{ERROR_TEXT[markState.error] ?? t.error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
