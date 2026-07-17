"use client";

import { useActionState } from "react";

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

      <label className="flex flex-col gap-1 text-sm">
        {t.titleLabel}
        <input
          name="title"
          required
          maxLength={200}
          defaultValue={editing?.title}
          className="input"
        />
        {errors.title ? <span className="text-xs text-red-600">{errors.title}</span> : null}
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          {t.providerLabel}
          <select name="provider" defaultValue={editing?.provider ?? "zoom"} className="input">
            <option value="zoom">{t.providers.zoom}</option>
            <option value="meet">{t.providers.meet}</option>
            <option value="teams">{t.providers.teams}</option>
            <option value="otro">{t.providers.otro}</option>
          </select>
          {errors.provider ? <span className="text-xs text-red-600">{errors.provider}</span> : null}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t.meetingUrlLabel}
          <input
            name="meetingUrl"
            type="url"
            required
            maxLength={500}
            placeholder="https://…"
            defaultValue={editing?.meetingUrl}
            className="input"
          />
          <span className="text-muted-foreground text-xs">{t.meetingUrlHint}</span>
          {errors.meetingUrl ? <span className="text-xs text-red-600">{errors.meetingUrl}</span> : null}
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          {t.startsAtLabel}
          <input
            name="startsAt"
            type="datetime-local"
            required
            defaultValue={editing ? toLocalInputValue(editing.startsAtMs) : undefined}
            className="input"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.endsAtLabel}
          <input
            name="endsAt"
            type="datetime-local"
            required
            defaultValue={editing ? toLocalInputValue(editing.endsAtMs) : undefined}
            className="input"
          />
        </label>
      </div>
      {errors.dates ? <span className="text-xs text-red-600">{errors.dates}</span> : null}

      <label className="flex flex-col gap-1 text-sm">
        {t.detailsLabel}
        <textarea name="details" rows={3} defaultValue={editing?.details} className="input" />
        {errors.details ? <span className="text-xs text-red-600">{errors.details}</span> : null}
      </label>

      {state?.ok ? <p role="status" className="text-sm text-green-700 dark:text-green-400">{t.saved}</p> : null}
      {state && !state.ok && !state.errors ? (
        <p role="alert" className="text-sm text-red-600">{t.genericError}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-md bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 sm:w-auto dark:bg-white dark:text-neutral-900"
      >
        {t.save}
      </button>
    </form>
  );
}
