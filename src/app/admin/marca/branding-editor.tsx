"use client";

import { useActionState, useState } from "react";

import { esCL } from "@/i18n/es-CL";
import { checkBrandColor } from "@/modules/core/domain/contrast";
import type { SaveBrandingResult } from "@/modules/core/branding-service";
import { saveBrandingAction } from "./actions";

const t = esCL.branding;

interface Initial {
  primaryColor: string;
  accentColor: string;
  logoUrl: string;
  name: string;
  rut: string;
}

/** Muestra el estado de contraste de un color y ofrece aplicar la sugerencia. */
function ContrastBadge({
  color,
  onApply,
}: {
  color: string;
  onApply: (hex: string) => void;
}) {
  const check = checkBrandColor(color);
  if (!check) return null;
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      {check.ok ? (
        <span className="text-green-700 dark:text-green-400">
          {t.contrastOk} ({t.ratio} {check.ratio.toFixed(1)}:1)
        </span>
      ) : (
        <>
          <span className="text-amber-700 dark:text-amber-400">
            {t.contrastWarn} ({t.ratio} {check.ratio.toFixed(1)}:1)
          </span>
          {check.suggestion ? (
            <button
              type="button"
              onClick={() => onApply(check.suggestion!)}
              className="inline-flex items-center gap-1 rounded border px-2 py-0.5"
            >
              <span className="inline-block size-3 rounded-full border" style={{ background: check.suggestion }} />
              {t.applySuggestion}
            </button>
          ) : null}
        </>
      )}
    </span>
  );
}

export function BrandingEditor({ initial }: { initial: Initial }) {
  const [state, formAction, pending] = useActionState<SaveBrandingResult | null, FormData>(
    saveBrandingAction,
    null,
  );
  const [primary, setPrimary] = useState(initial.primaryColor);
  const [accent, setAccent] = useState(initial.accentColor);
  const [name, setName] = useState(initial.name);
  const [logo, setLogo] = useState(initial.logoUrl);

  const primaryText = checkBrandColor(primary)?.textColor ?? "#ffffff";

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <form action={formAction} className="flex flex-col gap-5">
        <label className="flex flex-col gap-1 text-sm">
          {t.nameLabel}
          <input name="name" required value={name} onChange={(e) => setName(e.target.value)} className="min-h-11 rounded-md border px-3 text-base" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.rutLabel}
          <input name="rut" defaultValue={initial.rut} placeholder="76111111-6" className="min-h-11 rounded-md border px-3 text-base" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t.logoLabel}
          <input name="logoUrl" value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…/logo.png" className="min-h-11 rounded-md border px-3 text-base" />
          <span className="text-muted-foreground text-xs">{t.logoHint}</span>
        </label>

        <div className="flex flex-col gap-2">
          <label className="flex items-center justify-between gap-3 text-sm">
            {t.primaryLabel}
            <span className="flex items-center gap-2">
              <input value={primary} onChange={(e) => setPrimary(e.target.value)} name="primaryColor" className="w-24 rounded-md border px-2 py-1 font-mono text-xs" />
              <input type="color" aria-label={t.primaryLabel} value={/^#[0-9a-fA-F]{6}$/.test(primary) ? primary : "#1e3a8a"} onChange={(e) => setPrimary(e.target.value)} className="size-9 rounded" />
            </span>
          </label>
          <ContrastBadge color={primary} onApply={setPrimary} />
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center justify-between gap-3 text-sm">
            {t.accentLabel}
            <span className="flex items-center gap-2">
              <input value={accent} onChange={(e) => setAccent(e.target.value)} name="accentColor" className="w-24 rounded-md border px-2 py-1 font-mono text-xs" />
              <input type="color" aria-label={t.accentLabel} value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#0ea5e9"} onChange={(e) => setAccent(e.target.value)} className="size-9 rounded" />
            </span>
          </label>
          <ContrastBadge color={accent} onApply={setAccent} />
        </div>

        {state?.ok ? <p role="status" className="text-sm text-green-700 dark:text-green-400">{t.saved}</p> : null}
        {state && !state.ok && "error" in state ? <p role="alert" className="text-sm text-red-600">{t.genericError}</p> : null}

        <button type="submit" disabled={pending} className="min-h-11 rounded-md bg-neutral-900 px-4 font-medium text-white disabled:opacity-60 sm:w-auto dark:bg-white dark:text-neutral-900">
          {t.save}
        </button>
      </form>

      <aside className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t.previewTitle}</h2>
        <div className="overflow-hidden rounded-lg border">
          <div className="flex items-center gap-3 p-4" style={{ background: primary, color: primaryText }}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="h-8 w-auto max-w-[8rem] object-contain" />
            ) : (
              <span className="font-bold">{name || "Chilearning"}</span>
            )}
          </div>
          <div className="flex flex-col gap-3 p-4">
            <p className="font-medium">{t.previewCourse}</p>
            <p className="text-muted-foreground text-sm">{t.previewBody}</p>
            <button type="button" className="min-h-11 w-fit rounded-md px-4 font-medium" style={{ background: primary, color: primaryText }}>
              {t.previewButton}
            </button>
            <span className="text-sm font-medium" style={{ color: accent }}>
              {name || "Chilearning"}
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}
