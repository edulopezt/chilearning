"use client";

import { useActionState, useState } from "react";

import { esCL } from "@/i18n/es-CL";
import { checkBrandColor } from "@/modules/core/domain/contrast";
import type { SaveBrandingResult } from "@/modules/core/branding-service";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldControl, FieldDescription, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <span className="flex flex-wrap items-center gap-2">
      {check.ok ? (
        <Badge variant="success">
          {t.contrastOk} ({t.ratio} {check.ratio.toFixed(1)}:1)
        </Badge>
      ) : (
        <>
          <Badge variant="warning">
            {t.contrastWarn} ({t.ratio} {check.ratio.toFixed(1)}:1)
          </Badge>
          {check.suggestion ? (
            <Button type="button" variant="outline" onClick={() => onApply(check.suggestion!)}>
              <span className="inline-block size-3 rounded-full border" style={{ background: check.suggestion }} />
              {t.applySuggestion}
            </Button>
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
        <FieldRoot>
          <FieldLabel>{t.nameLabel}</FieldLabel>
          <FieldControl name="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </FieldRoot>
        <FieldRoot>
          <FieldLabel>{t.rutLabel}</FieldLabel>
          <FieldControl name="rut" defaultValue={initial.rut} placeholder="76111111-6" />
        </FieldRoot>
        <FieldRoot>
          <FieldLabel>{t.logoLabel}</FieldLabel>
          <FieldControl
            name="logoUrl"
            value={logo}
            onChange={(e) => setLogo(e.target.value)}
            placeholder="https://…/logo.png"
          />
          <FieldDescription>{t.logoHint}</FieldDescription>
        </FieldRoot>

        <div className="flex flex-col gap-2">
          <Label className="flex items-center justify-between gap-3 font-normal">
            {t.primaryLabel}
            <span className="flex items-center gap-2">
              <Input
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
                name="primaryColor"
                className="w-24 px-2 font-mono text-xs"
              />
              <input
                type="color"
                aria-label={t.primaryLabel}
                value={/^#[0-9a-fA-F]{6}$/.test(primary) ? primary : "#1e3a8a"}
                onChange={(e) => setPrimary(e.target.value)}
                className="h-11 w-14 cursor-pointer rounded-md border border-input p-1"
              />
            </span>
          </Label>
          <ContrastBadge color={primary} onApply={setPrimary} />
        </div>

        <div className="flex flex-col gap-2">
          <Label className="flex items-center justify-between gap-3 font-normal">
            {t.accentLabel}
            <span className="flex items-center gap-2">
              <Input
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                name="accentColor"
                className="w-24 px-2 font-mono text-xs"
              />
              <input
                type="color"
                aria-label={t.accentLabel}
                value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#0ea5e9"}
                onChange={(e) => setAccent(e.target.value)}
                className="h-11 w-14 cursor-pointer rounded-md border border-input p-1"
              />
            </span>
          </Label>
          <ContrastBadge color={accent} onApply={setAccent} />
        </div>

        {state?.ok ? (
          <Alert variant="success" role="status">
            <AlertDescription>{t.saved}</AlertDescription>
          </Alert>
        ) : null}
        {state && !state.ok && "error" in state ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{t.genericError}</AlertDescription>
          </Alert>
        ) : null}

        <Button type="submit" loading={pending} className="sm:w-auto">
          {t.save}
        </Button>
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
            <button
              type="button"
              className="inline-flex h-11 w-fit items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors"
              style={{ background: primary, color: primaryText }}
            >
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
