"use client";

import { useActionState, useState } from "react";

import { esCL } from "@/i18n/es-CL";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldControl, FieldDescription, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  createCompanyAction,
  inviteCompanyMemberAction,
  type CreateCompanyState,
  type InviteMemberState,
} from "./actions";

const t = esCL.companies;

const ERRORS: Record<string, string> = {
  invalid: t.errorInvalid,
  duplicate: t.errorDuplicate,
  company_not_found: t.errorCompanyNotFound,
  failed: t.errorFailed,
  forbidden: t.forbidden,
};

interface CompanyOption {
  readonly id: string;
  readonly razonSocial: string;
  readonly rut: string;
}

/**
 * Alta de empresa (task 5.2). Client component solo para reportar el error de
 * validación del RUT sin recargar; el servicio revalida igual en el servidor.
 */
export function CreateCompanyForm() {
  const [state, formAction, pending] = useActionState<CreateCompanyState, FormData>(createCompanyAction, {
    ok: false,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.createHeading}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <FieldRoot>
            <FieldLabel>{t.rut}</FieldLabel>
            <FieldControl name="rut" required inputMode="text" />
            <FieldDescription>{t.rutHint}</FieldDescription>
          </FieldRoot>

          <FieldRoot>
            <FieldLabel>{t.razonSocial}</FieldLabel>
            <FieldControl name="razonSocial" required maxLength={200} />
          </FieldRoot>

          <Button type="submit" loading={pending} className="w-full sm:w-auto">
            {t.create}
          </Button>

          {state.error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{ERRORS[state.error] ?? t.errorFailed}</AlertDescription>
            </Alert>
          ) : null}
          {state.ok ? (
            <Alert variant="success" role="status">
              <AlertDescription>{t.createOk}</AlertDescription>
            </Alert>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Invitación de RRHH (task 5.2) — espejo del formulario del fiscalizador:
 * muestra el enlace de acceso devuelto cuando no hay correo configurado.
 */
export function InviteForm({ companies }: { companies: readonly CompanyOption[] }) {
  const [state, formAction, pending] = useActionState<InviteMemberState, FormData>(inviteCompanyMemberAction, {
    ok: false,
  });
  const [copied, setCopied] = useState(false);

  if (companies.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.inviteHeading}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{t.noCompanies}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.inviteHeading}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <FieldRoot>
            <FieldLabel>{t.company}</FieldLabel>
            <Select name="companyId" required defaultValue={companies[0]?.id}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.razonSocial} · {c.rut}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRoot>

          <FieldRoot>
            <FieldLabel>{t.email}</FieldLabel>
            <FieldControl type="email" name="email" required />
          </FieldRoot>

          <Button type="submit" loading={pending} className="w-full sm:w-auto">
            {t.invite}
          </Button>

          {state.error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{ERRORS[state.error] ?? t.errorFailed}</AlertDescription>
            </Alert>
          ) : null}
          {state.ok ? (
            <Alert variant="success" role="status">
              <div className="flex flex-1 flex-col gap-2">
                <AlertTitle>{t.inviteOk}</AlertTitle>
                {state.emailSent ? (
                  <AlertDescription>{t.emailSent}</AlertDescription>
                ) : state.inviteLink ? (
                  <AlertDescription className="flex flex-col gap-2">
                    <span>{t.emailNotSent}</span>
                    <div className="flex items-center gap-2">
                      <code className="bg-muted flex-1 truncate rounded px-2 py-1 text-xs">
                        {state.inviteLink}
                      </code>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          void navigator.clipboard.writeText(state.inviteLink!);
                          setCopied(true);
                        }}
                      >
                        {copied ? "✓" : t.copy}
                      </Button>
                    </div>
                  </AlertDescription>
                ) : null}
              </div>
            </Alert>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
