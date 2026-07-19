"use client";

import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldControl, FieldDescription, FieldError, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { esCL } from "@/i18n/es-CL";
import type { LiveSessionMutationResult, LiveSessionRow } from "@/modules/academico/live-session-service";
import { createSessionAction, updateSessionAction } from "./actions";

const t = esCL.liveSessions;

function fieldErrors(state: LiveSessionMutationResult | null): Record<string, string> {
  if (state && !state.ok && state.errors) {
    return Object.fromEntries(state.errors.map((e) => [e.field, e.message]));
  }
  return {};
}

/** Convierte un epoch ms a valor de `<input type="datetime-local">` (hora local). */
function toLocalInputValue(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SessionForm({ actionId, editing }: { actionId: string; editing: LiveSessionRow | null }) {
  const action = editing ? updateSessionAction : createSessionAction;
  const [state, formAction, pending] = useActionState<LiveSessionMutationResult | null, FormData>(action, null);
  const errors = fieldErrors(state);

  return (
    <form action={formAction} className="flex flex-col gap-5" key={editing?.id ?? "new"}>
      <input type="hidden" name="actionId" value={actionId} />
      {editing ? <input type="hidden" name="sessionId" value={editing.id} /> : null}

      <FieldRoot invalid={!!errors.title}>
        <FieldLabel>{t.titleLabel}</FieldLabel>
        <FieldControl name="title" required maxLength={200} defaultValue={editing?.title} />
        {errors.title ? <FieldError>{errors.title}</FieldError> : null}
      </FieldRoot>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm leading-none font-medium select-none">{t.providerLabel}</label>
          <Select name="provider" defaultValue={editing?.provider ?? "zoom"}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zoom">{t.providers.zoom}</SelectItem>
              <SelectItem value="meet">{t.providers.meet}</SelectItem>
              <SelectItem value="teams">{t.providers.teams}</SelectItem>
              <SelectItem value="otro">{t.providers.otro}</SelectItem>
            </SelectContent>
          </Select>
          {errors.provider ? <p className="text-sm font-medium text-destructive">{errors.provider}</p> : null}
        </div>

        <FieldRoot invalid={!!errors.meetingUrl}>
          <FieldLabel>{t.meetingUrlLabel}</FieldLabel>
          <FieldControl
            name="meetingUrl"
            type="url"
            required
            maxLength={500}
            placeholder="https://…"
            defaultValue={editing?.meetingUrl}
          />
          <FieldDescription>{t.meetingUrlHint}</FieldDescription>
          {errors.meetingUrl ? <FieldError>{errors.meetingUrl}</FieldError> : null}
        </FieldRoot>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FieldRoot>
          <FieldLabel>{t.startsAtLabel}</FieldLabel>
          <FieldControl
            name="startsAt"
            type="datetime-local"
            required
            defaultValue={editing ? toLocalInputValue(editing.startsAtMs) : undefined}
          />
        </FieldRoot>
        <FieldRoot>
          <FieldLabel>{t.endsAtLabel}</FieldLabel>
          <FieldControl
            name="endsAt"
            type="datetime-local"
            required
            defaultValue={editing ? toLocalInputValue(editing.endsAtMs) : undefined}
          />
        </FieldRoot>
      </div>
      {errors.dates ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{errors.dates}</AlertDescription>
        </Alert>
      ) : null}

      <FieldRoot invalid={!!errors.details}>
        <FieldLabel>{t.detailsLabel}</FieldLabel>
        <FieldControl name="details" defaultValue={editing?.details} render={<Textarea rows={3} />} />
        {errors.details ? <FieldError>{errors.details}</FieldError> : null}
      </FieldRoot>

      {state?.ok ? (
        <Alert variant="success" role="status">
          <AlertDescription>{t.saved}</AlertDescription>
        </Alert>
      ) : null}
      {state && !state.ok && !state.errors ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t.genericError}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" loading={pending} className="w-full sm:w-auto">
        {t.save}
      </Button>
    </form>
  );
}
